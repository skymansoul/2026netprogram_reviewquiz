# 网络编程复习题库网站

这是一个静态刷题网站，题库数据来自上级目录的 `fuxi_clean_qa.docx`。

## 更新题库数据

```powershell
python .\scripts\extract_questions.py
```

## Docker 启动

```powershell
docker compose up --build
```

打开 `http://localhost:8080`。

## GitHub Pages + Cloudflare 登录

Docker 版前端在 `app/`，GitHub Pages 版前端在 `pages-app/`。`pages-app/` 默认要求先 GitHub 登录才能填写、判题和保存进度。登录、注册和每个 GitHub 用户独立进度由 `worker/` 里的 Cloudflare Worker + D1 提供。

### 1. GitHub OAuth App

在 GitHub 创建 OAuth App：

- Homepage URL: `https://你的域名`
- Authorization callback URL: `https://你的域名/api/auth/callback`

拿到 `Client ID` 和 `Client Secret`。

### 2. Cloudflare D1 和 Worker

```powershell
cd .\worker
copy .\wrangler.toml.example .\wrangler.toml
wrangler d1 create quiz_site
wrangler d1 execute quiz_site --remote --file .\schema.sql
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put COOKIE_SECRET
wrangler deploy
```

把 `wrangler.toml` 里的 `APP_URL`、`ALLOWED_ORIGINS`、`GITHUB_CLIENT_ID`、`database_id` 换成自己的值。

### 3. GitHub Pages

仓库启用 GitHub Pages，使用 `.github/workflows/pages.yml` 发布 `quiz-site/pages-app`。如果 API 不在同域，把 `pages-app/config.js` 里的 `apiBase` 改成 Cloudflare Worker 地址，例如：

```js
window.APP_CONFIG = {
  apiBase: "https://quiz-site-api.your-subdomain.workers.dev/api",
};
```

如果使用自己的域名并接入 Cloudflare，推荐把 Worker 路由配置成 `你的域名/api/*`，这样 `apiBase` 可以保持默认的 `/api`。
