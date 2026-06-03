const SESSION_COOKIE = "quiz_session";
const OAUTH_STATE_COOKIE = "quiz_oauth_state";
const RETURN_TO_COOKIE = "quiz_return_to";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request, env) });
    }

    try {
      if (url.pathname === "/api/auth/login") return authLogin(request, env);
      if (url.pathname === "/api/auth/callback") return authCallback(request, env);
      if (url.pathname === "/api/auth/logout") return authLogout(request, env);
      if (url.pathname === "/api/me") return json(request, env, { user: await getSessionUser(request, env) });
      if (url.pathname === "/api/progress") return progress(request, env);
      return json(request, env, { error: "Not found" }, 404);
    } catch (error) {
      return json(request, env, { error: error.message || "Server error" }, 500);
    }
  },
};

async function authLogin(request, env) {
  const url = new URL(request.url);
  const state = crypto.randomUUID();
  const returnTo = url.searchParams.get("returnTo") || env.APP_URL || "/";
  const callbackUrl = new URL("/api/auth/callback", url.origin).toString();
  const githubUrl = new URL("https://github.com/login/oauth/authorize");
  githubUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  githubUrl.searchParams.set("redirect_uri", callbackUrl);
  githubUrl.searchParams.set("scope", "read:user");
  githubUrl.searchParams.set("state", state);

  return redirect(githubUrl.toString(), [
    cookie(OAUTH_STATE_COOKIE, state, 600, true),
    cookie(RETURN_TO_COOKIE, returnTo, 600, true),
  ]);
}

async function authCallback(request, env) {
  const url = new URL(request.url);
  const expectedState = readCookie(request, OAUTH_STATE_COOKIE);
  const actualState = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  if (!code || !expectedState || expectedState !== actualState) {
    return new Response("Invalid OAuth state", { status: 400 });
  }

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "quiz-site-worker",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) {
    return new Response("GitHub token exchange failed", { status: 401 });
  }

  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${tokenData.access_token}`,
      accept: "application/vnd.github+json",
      "user-agent": "quiz-site-worker",
    },
  });
  const githubUser = await userResponse.json();
  if (!githubUser.id) {
    return new Response("GitHub profile fetch failed", { status: 401 });
  }

  await env.DB.prepare(
    `insert into users (id, login, avatar_url, html_url, updated_at)
     values (?, ?, ?, ?, datetime('now'))
     on conflict(id) do update set
       login = excluded.login,
       avatar_url = excluded.avatar_url,
       html_url = excluded.html_url,
       updated_at = datetime('now')`,
  )
    .bind(githubUser.id, githubUser.login, githubUser.avatar_url || "", githubUser.html_url || "")
    .run();

  const session = await createSession(env, {
    id: githubUser.id,
    login: githubUser.login,
    avatarUrl: githubUser.avatar_url || "",
    htmlUrl: githubUser.html_url || "",
  });
  const returnTo = readCookie(request, RETURN_TO_COOKIE) || env.APP_URL || "/";

  return redirect(returnTo, [
    cookie(SESSION_COOKIE, session, SESSION_TTL_SECONDS, true),
    clearCookie(OAUTH_STATE_COOKIE),
    clearCookie(RETURN_TO_COOKIE),
  ]);
}

function authLogout(request, env) {
  return json(request, env, { ok: true }, 200, [clearCookie(SESSION_COOKIE)]);
}

async function progress(request, env) {
  const user = await requireUser(request, env);

  if (request.method === "GET") {
    const row = await env.DB.prepare("select data from progress where user_id = ?").bind(user.id).first();
    return json(request, env, { progress: row?.data ? JSON.parse(row.data) : {} });
  }

  if (request.method === "PUT") {
    const body = await request.json();
    const progressData = body.progress && typeof body.progress === "object" ? body.progress : {};
    await env.DB.prepare(
      `insert into progress (user_id, data, updated_at)
       values (?, ?, datetime('now'))
       on conflict(user_id) do update set
         data = excluded.data,
         updated_at = datetime('now')`,
    )
      .bind(user.id, JSON.stringify(progressData))
      .run();
    return json(request, env, { ok: true });
  }

  return json(request, env, { error: "Method not allowed" }, 405);
}

async function requireUser(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) throw new Error("Unauthorized");
  return user;
}

async function getSessionUser(request, env) {
  const session = readCookie(request, SESSION_COOKIE);
  if (!session) return null;

  const payload = await verifySession(env, session);
  if (!payload || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return {
    id: payload.id,
    login: payload.login,
    avatarUrl: payload.avatarUrl,
    htmlUrl: payload.htmlUrl,
  };
}

async function createSession(env, user) {
  const payload = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const encoded = base64urlEncode(JSON.stringify(payload));
  const signature = await sign(env, encoded);
  return `${encoded}.${signature}`;
}

async function verifySession(env, session) {
  const [encoded, signature] = session.split(".");
  if (!encoded || !signature) return null;
  const expected = await sign(env, encoded);
  if (expected !== signature) return null;
  return JSON.parse(base64urlDecode(encoded));
}

async function sign(env, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.COOKIE_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64urlEncodeBytes(new Uint8Array(signature));
}

function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  const cookies = Object.fromEntries(
    header.split(";").map((item) => {
      const [key, ...value] = item.trim().split("=");
      return [key, decodeURIComponent(value.join("=") || "")];
    }),
  );
  return cookies[name] || "";
}

function cookie(name, value, maxAge, httpOnly) {
  const flags = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "Secure",
    "SameSite=None",
  ];
  if (httpOnly) flags.push("HttpOnly");
  return flags.join("; ");
}

function clearCookie(name) {
  return `${name}=; Path=/; Max-Age=0; Secure; SameSite=None; HttpOnly`;
}

function redirect(location, cookies = []) {
  const headers = new Headers({ location });
  cookies.forEach((item) => headers.append("set-cookie", item));
  return new Response(null, { status: 302, headers });
}

function json(request, env, data, status = 200, cookies = []) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    ...corsHeaders(request, env),
  });
  cookies.forEach((item) => headers.append("set-cookie", item));
  return new Response(JSON.stringify(data), { status, headers });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const allowed = (env.ALLOWED_ORIGINS || env.APP_URL || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || origin || "*";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function base64urlEncode(value) {
  return base64urlEncodeBytes(new TextEncoder().encode(value));
}

function base64urlEncodeBytes(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
