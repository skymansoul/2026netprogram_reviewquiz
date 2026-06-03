# GitHub Pages + Cloudflare + GitHub 登录部署手册

这份手册用于把复习题库网站部署到：

- GitHub Pages：托管静态前端，也就是 `pages-app/`
- Cloudflare Worker：处理 `/api/*`、GitHub 登录、会话、个人进度
- Cloudflare D1：保存每个 GitHub 用户自己的刷题进度
- Cloudflare 域名：把你的域名统一接到前端和 API

部署后效果：

- 未登录：只能浏览题目，不能填写、提交判题、显示答案、标记进度
- 已登录：可以答题、判题、保存个人进度
- 每个 GitHub 用户的进度互相隔离

## 目录结构

当前项目里和部署有关的文件：

```text
quiz-site/
  pages-app/                         GitHub Pages 发布目录，强制 GitHub 登录后才能答题
    index.html
    config.js
    data.js
    app.js
    styles.css

  worker/                            Cloudflare Worker 后端
    src/index.js
    schema.sql
    wrangler.toml.example

  .github/workflows/
    pages.yml                        发布 GitHub Pages
    worker.yml                       发布 Cloudflare Worker
```

Docker 版前端在 `app/`，这份手册不使用它。

## 你需要准备的信息

先确定下面几个值，后面会反复用到：

```text
GitHub 用户名：YOUR_GITHUB_USERNAME
GitHub 仓库名：YOUR_REPO
你的域名：example.com
网站子域名：quiz.example.com
Cloudflare Worker 名称：quiz-site-api
D1 数据库名：quiz_site
```

下面示例统一使用：

```text
https://quiz.example.com
```

你部署时把它替换成自己的真实域名。

## 第 1 步：确认 GitHub 仓库根目录

这里有两种情况，先确认你是哪一种。

### 情况 A：把 `quiz-site` 文件夹作为仓库根目录

如果你打开仓库后，根目录直接能看到：

```text
pages-app/
worker/
.github/
README.md
```

那么 GitHub Pages workflow 里的发布路径应该是：

```yaml
path: pages-app
```

Worker workflow 里的工作目录应该是：

```yaml
workingDirectory: worker
```

### 情况 B：把外层 `doc` 目录作为仓库根目录

如果你打开仓库后，根目录先看到：

```text
quiz-site/
```

并且 `pages-app/` 在：

```text
quiz-site/pages-app/
```

那么 GitHub Pages workflow 里的发布路径应该是：

```yaml
path: quiz-site/pages-app
```

Worker workflow 里的工作目录应该是：

```yaml
workingDirectory: quiz-site/worker
```

当前项目默认按“情况 B”写好了。如果你采用“情况 A”，记得改 `.github/workflows/pages.yml` 和 `.github/workflows/worker.yml`。

GitHub 官方说明里，GitHub Pages 可以使用 GitHub Actions 的自定义 workflow，通过 `upload-pages-artifact` 上传静态站点，并用 `deploy-pages` 部署。参考：<https://docs.github.com/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages>

## 第 2 步：上传代码到 GitHub

如果你还没有仓库，先在 GitHub 创建一个新仓库，例如：

```text
network-quiz
```

然后把项目提交上去。示例：

```powershell
cd E:\win_c\Desktop\doc\quiz-site
git init
git add .
git commit -m "Add quiz site with GitHub login"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/network-quiz.git
git push -u origin main
```

如果你已经有仓库，只需要把这些文件复制进去后提交即可。

## 第 3 步：配置 GitHub Pages

进入 GitHub 仓库：

```text
Settings -> Pages
```

在 Build and deployment 中选择：

```text
Source: GitHub Actions
```

然后 GitHub 会使用 `.github/workflows/pages.yml` 发布 `pages-app/`。

先不用急着配置自定义域名，等 Cloudflare DNS 接好后再填。

## 第 4 步：把域名接入 Cloudflare

如果你的域名已经在 Cloudflare，跳过这一节。

如果还没接入：

1. 登录 Cloudflare Dashboard
2. Add a site
3. 输入你的根域名，例如：

```text
example.com
```

4. Cloudflare 会给你两条 nameserver
5. 去你的域名注册商后台，把 nameserver 改成 Cloudflare 给的
6. 等待生效

生效后，你的域名 DNS 就由 Cloudflare 管理。

## 第 5 步：配置 GitHub Pages 域名 DNS

假设你要用：

```text
quiz.example.com
```

在 Cloudflare：

```text
Websites -> example.com -> DNS -> Records -> Add record
```

添加：

```text
Type: CNAME
Name: quiz
Target: YOUR_GITHUB_USERNAME.github.io
Proxy status: Proxied，橙色云
```

说明：

- `quiz` 对应 `quiz.example.com`
- `YOUR_GITHUB_USERNAME.github.io` 替换成你的 GitHub 用户名
- 使用橙色云可以让 Cloudflare 接管请求，后面才能让 `/api/*` 走 Worker

然后回到 GitHub 仓库：

```text
Settings -> Pages -> Custom domain
```

填：

```text
quiz.example.com
```

等待 GitHub 完成 DNS 检查。如果出现证书未完成，等几分钟再刷新。

## 第 6 步：创建 GitHub OAuth App

进入 GitHub：

```text
头像 -> Settings -> Developer settings -> OAuth Apps -> New OAuth App
```

填写：

```text
Application name:
网络编程复习题库

Homepage URL:
https://quiz.example.com

Authorization callback URL:
https://quiz.example.com/api/auth/callback
```

创建后你会得到：

```text
Client ID
Client Secret
```

注意：

- `Client Secret` 不要写进前端
- GitHub OAuth App 通常只有一个 callback URL，所以正式域名确定后再填
- 当前 Worker 代码用的是 GitHub OAuth Web application flow

GitHub 创建 OAuth App 的官方说明：<https://docs.github.com/en/developers/apps/creating-an-oauth-app>

GitHub OAuth 授权流程说明：<https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps>

## 第 7 步：安装并登录 Wrangler

Cloudflare Worker 和 D1 使用 Wrangler 部署。

先检查 Node.js：

```powershell
node --version
npm --version
```

如果没有 Node.js，先安装 Node.js LTS。

安装 Wrangler：

```powershell
npm install -g wrangler
```

登录 Cloudflare：

```powershell
wrangler login
```

浏览器会打开 Cloudflare 授权页面，确认授权。

## 第 8 步：创建 D1 数据库

进入 Worker 目录。

如果你的仓库根目录是 `quiz-site`：

```powershell
cd E:\win_c\Desktop\doc\quiz-site\worker
```

如果你的仓库根目录是外层目录，也依然进入：

```powershell
cd E:\win_c\Desktop\doc\quiz-site\worker
```

创建 D1：

```powershell
wrangler d1 create quiz_site
```

命令输出里会有类似：

```toml
[[d1_databases]]
binding = "DB"
database_name = "quiz_site"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

复制这个 `database_id`，后面要填进 `wrangler.toml`。

Cloudflare D1 文档入口：<https://developers.cloudflare.com/d1/>

## 第 9 步：配置 Worker

复制配置模板：

```powershell
copy .\wrangler.toml.example .\wrangler.toml
```

打开：

```text
worker/wrangler.toml
```

改成类似这样：

```toml
name = "quiz-site-api"
main = "src/index.js"
compatibility_date = "2026-06-03"

[vars]
APP_URL = "https://quiz.example.com"
ALLOWED_ORIGINS = "https://quiz.example.com"
GITHUB_CLIENT_ID = "你的 GitHub OAuth Client ID"

[[d1_databases]]
binding = "DB"
database_name = "quiz_site"
database_id = "刚才 wrangler d1 create 返回的 database_id"
```

说明：

- `APP_URL` 是你的前端网址
- `ALLOWED_ORIGINS` 允许前端跨域请求 Worker
- `GITHUB_CLIENT_ID` 可以明文放在 `wrangler.toml`
- `GITHUB_CLIENT_SECRET` 不能放进 `wrangler.toml`，要用 secret
- `COOKIE_SECRET` 也要用 secret

## 第 10 步：初始化 D1 表结构

执行：

```powershell
wrangler d1 execute quiz_site --remote --file .\schema.sql
```

这个命令会创建两张表：

```text
users       GitHub 用户资料
progress    每个用户的刷题进度 JSON
```

以后如果只是更新前端或 Worker，不需要重复执行这一步。

## 第 11 步：设置 Worker 密钥

设置 GitHub OAuth Secret：

```powershell
wrangler secret put GITHUB_CLIENT_SECRET
```

它会提示你输入值，把 GitHub OAuth App 的 `Client Secret` 粘进去。

再设置 Cookie 签名密钥：

```powershell
wrangler secret put COOKIE_SECRET
```

`COOKIE_SECRET` 建议用一串长随机字符。可以在 PowerShell 里生成：

```powershell
[guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
```

复制输出作为 `COOKIE_SECRET`。

## 第 12 步：部署 Worker

在 `worker/` 目录执行：

```powershell
wrangler deploy
```

成功后会看到一个 Worker 地址，例如：

```text
https://quiz-site-api.YOUR_ACCOUNT.workers.dev
```

先临时测试：

```powershell
Invoke-WebRequest https://quiz-site-api.YOUR_ACCOUNT.workers.dev/api/me -UseBasicParsing
```

正常情况下未登录会返回类似：

```json
{"user":null}
```

Cloudflare Workers 路由/域名官方说明：<https://developers.cloudflare.com/workers/configuration/routing/>

## 第 13 步：把你的域名 `/api/*` 指到 Worker

这里推荐用 Worker Route，而不是把整个域名都给 Worker。

因为：

- `https://quiz.example.com/` 由 GitHub Pages 托管
- `https://quiz.example.com/api/*` 由 Cloudflare Worker 处理

进入 Cloudflare：

```text
Workers & Pages -> 你的 Worker -> Settings -> Domains & Routes -> Add route
```

添加 route：

```text
quiz.example.com/api/*
```

Zone 选择你的域名：

```text
example.com
```

保存。

Cloudflare Workers 支持 Routes、Custom Domains 和 workers.dev。官方说明里，Routes 适合让 Worker 跑在已有 origin 前面；这里 GitHub Pages 就是已有 origin，所以用 route 很合适。参考：<https://developers.cloudflare.com/workers/configuration/routing/>

## 第 14 步：确认 Pages 前端配置

打开：

```text
pages-app/config.js
```

如果你已经配置了同域名 `/api/*` route，保持：

```js
window.APP_CONFIG = {
  apiBase: "/api",
  requireLogin: true,
};
```

如果你暂时不用自定义域名，而是前端在 GitHub Pages，API 在 workers.dev，则改成：

```js
window.APP_CONFIG = {
  apiBase: "https://quiz-site-api.YOUR_ACCOUNT.workers.dev/api",
  requireLogin: true,
};
```

推荐最终使用同域名 `/api`，Cookie 和 OAuth 回跳都会更顺。

## 第 15 步：配置 GitHub Actions 发布 Pages

确认 `.github/workflows/pages.yml` 存在。

如果你是“情况 B”，也就是仓库根目录下还有 `quiz-site/` 子目录，内容应该类似：

```yaml
name: Deploy GitHub Pages

on:
  push:
    branches: ["main"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: quiz-site/pages-app
      - id: deployment
        uses: actions/deploy-pages@v4
```

如果你是“情况 A”，把路径改成：

```yaml
path: pages-app
```

提交后 GitHub 会自动发布。

## 第 16 步：可选，配置 GitHub Actions 自动部署 Worker

如果你想让 Worker 也跟着 GitHub Actions 自动部署，需要在 GitHub 仓库里添加 Cloudflare API Token。

### 创建 Cloudflare API Token

Cloudflare Dashboard：

```text
头像 -> My Profile -> API Tokens -> Create Token
```

建议给这些权限：

```text
Account -> Workers Scripts -> Edit
Account -> D1 -> Edit
Zone -> Workers Routes -> Edit
Zone -> Zone -> Read
```

资源范围选择你的账号和域名。

复制生成的 token。

### 添加 GitHub Secret

GitHub 仓库：

```text
Settings -> Secrets and variables -> Actions -> New repository secret
```

添加：

```text
Name: CLOUDFLARE_API_TOKEN
Value: 刚才复制的 Cloudflare API Token
```

之后 `.github/workflows/worker.yml` 就可以部署 Worker。

注意：

- `wrangler.toml` 不能提交敏感 secret
- `GITHUB_CLIENT_SECRET` 和 `COOKIE_SECRET` 仍然应该用 `wrangler secret put` 设置

## 第 17 步：完整验收流程

按顺序检查。

### 1. 前端可以打开

浏览器打开：

```text
https://quiz.example.com
```

应该看到题库页面。

未登录时：

- 能浏览题目
- 作答区显示“当前为未登录状态，作答区已锁定”
- “提交判题”“显示答案”“标为待复习”“标为已掌握”不可用

### 2. API 可以访问

浏览器打开：

```text
https://quiz.example.com/api/me
```

未登录应该返回：

```json
{"user":null}
```

如果返回 GitHub Pages 的 404，说明 `/api/*` 没有正确指到 Worker。

如果返回 Cloudflare 错误，去 Worker Logs 看错误。

### 3. GitHub 登录可以跳转

点击页面里的：

```text
GitHub 登录
```

应该跳到 GitHub 授权页面。

授权后应该回到：

```text
https://quiz.example.com
```

并显示你的 GitHub 用户名。

### 4. 登录后可以答题

登录后检查：

- 填空题出现输入框
- 单选题出现选项
- 判断题出现“对/错”
- 简答题出现文本框
- 点击“提交判题”后有正确/错误提示
- 进度会变成“已掌握”或“待复习”

### 5. 进度隔离

用另一个 GitHub 账号登录，或者让同学登录：

- 不应该看到你的答题进度
- 他自己的作答会保存到他自己的 GitHub 用户 ID 下

## 第 18 步：常见问题

### 点击登录后 GitHub 提示 callback URL 不匹配

检查 GitHub OAuth App：

```text
Authorization callback URL
```

必须是：

```text
https://quiz.example.com/api/auth/callback
```

协议、域名、路径都要对。

### 登录后回到页面但仍显示未登录

检查：

1. Worker route 是否是 `quiz.example.com/api/*`
2. `pages-app/config.js` 是否是 `apiBase: "/api"`
3. Cloudflare DNS 中 `quiz.example.com` 是否是橙色云
4. 浏览器开发者工具里 `/api/me` 是否返回用户信息

### `/api/me` 打开是 GitHub Pages 404

说明请求没有进 Worker。

检查 Cloudflare Worker route：

```text
quiz.example.com/api/*
```

还要确认 DNS 记录是 Proxied 橙色云。

### `wrangler d1 execute` 找不到数据库

检查 `wrangler.toml`：

```toml
database_name = "quiz_site"
database_id = "真实 database_id"
```

也可以执行：

```powershell
wrangler d1 list
```

确认数据库存在。

### 前端部署后还是旧版本

检查 GitHub Actions：

```text
Actions -> Deploy GitHub Pages
```

确认 workflow 成功。

浏览器强刷：

```text
Ctrl + F5
```

或者等 GitHub Pages/CDN 缓存刷新。

### 不想用自定义域名，只用 GitHub Pages + workers.dev

也可以，但要改两处：

`pages-app/config.js`：

```js
window.APP_CONFIG = {
  apiBase: "https://quiz-site-api.YOUR_ACCOUNT.workers.dev/api",
  requireLogin: true,
};
```

GitHub OAuth App callback URL：

```text
https://quiz-site-api.YOUR_ACCOUNT.workers.dev/api/auth/callback
```

这种方式可用，但最终更推荐自定义域名统一到 `/api/*`。

## 第 19 步：最终应该保留的线上配置

前端：

```js
window.APP_CONFIG = {
  apiBase: "/api",
  requireLogin: true,
};
```

GitHub OAuth App：

```text
Homepage URL:
https://quiz.example.com

Authorization callback URL:
https://quiz.example.com/api/auth/callback
```

Cloudflare Worker route：

```text
quiz.example.com/api/*
```

Cloudflare DNS：

```text
CNAME quiz YOUR_GITHUB_USERNAME.github.io
Proxy status: Proxied
```

Worker secrets：

```text
GITHUB_CLIENT_SECRET
COOKIE_SECRET
```

D1 binding：

```toml
binding = "DB"
database_name = "quiz_site"
database_id = "你的 D1 database_id"
```

## 参考文档

- GitHub Pages custom workflows: <https://docs.github.com/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages>
- GitHub Pages publishing source: <https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site>
- GitHub OAuth App creation: <https://docs.github.com/en/developers/apps/creating-an-oauth-app>
- GitHub OAuth authorization flow: <https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps>
- Cloudflare Workers routes and domains: <https://developers.cloudflare.com/workers/configuration/routing/>
- Cloudflare Workers custom domains: <https://developers.cloudflare.com/workers/configuration/routing/custom-domains>
- Cloudflare D1: <https://developers.cloudflare.com/d1/>
