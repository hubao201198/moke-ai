# 贸客 AI

面向外贸团队的网页版 MVP：公开来源找客户、客户库、邮件跟进、知识与素材、工作流任务、审核、订单回款和经营数据。

## 架构

- `frontend/`：Next.js 16 界面与页面访问控制，不实现业务 API。
- `backend/`：独立 Go HTTP 服务，处理 `/api/*`、数据库迁移、搜索、AI、邮件、工作流和审核。
- Neon PostgreSQL：保存业务数据。Go 服务启动时执行版本化、幂等迁移。
- `vercel.json`：Vercel Services 将 `/api/*` 路由到 Go 容器，其余路由到 Next.js；GitHub 推送触发自动构建与预览部署。

`legacy/` 是本地迁移参考，已从发布仓库排除。企微厂商接口尚未接入：加微、私聊、群发只建立和审核待发送队列，不会伪称已发送。

## 本地开发

要求 Go 1.26、Node.js 22.13+、PostgreSQL，并在系统中提供 `pdftotext`（PDF 知识文件解析）。

1. 参考 `.env.example` 在本机配置环境变量，至少设置 `DATABASE_URL`、`APP_ACCESS_PASSWORD` 和 `APP_SESSION_SECRET`。Neon 的 `DATABASE_URL` 使用连接池时，还须配置直连 `DATABASE_URL_UNPOOLED` 供数据库迁移使用。不要提交真实密钥。
2. 在 `backend/` 执行 `go run ./cmd/server`（默认监听 `:8080`）。
3. 在 `frontend/` 执行 `npm ci`、`npm run dev`。开发时可用 `vercel dev -L` 按生产路由同时启动两个服务；单独启动 Next.js 时需自行把 `/api/*` 代理到 Go。
4. 运行 `go test ./...`、`go vet ./...`、`npm run lint`、`npm run build`。

## 上线与安全

Vercel 项目 Framework Preset 必须设为 **Services**；仅有 `vercel.json` 还不够。先验证 Preview，再将既有 `maoke-ai.vercel.app` 切换到新项目。上线前检查健康接口、登录、搜索、客户保存、审核、收件/退订和订单回款；生产密钥通过 Vercel 环境变量提供，不复制到仓库。`kuramathi.cn` 不属于此项目。

当前免费版 Cron 每日检查一次到期的自动化与邮件跟进任务（配置为 UTC 00:00 和 00:05，实际触发时间可能在当小时内）。因此“每周几几点”的计划不是准点发送，通常延迟到次日检查；任务积压或失败时可能更久。邮件草稿必须经人工审核才会通过 Resend 发送，每日上限 100 封。企微/微信任务无发送渠道时仅停留在待发送状态。

## 环境变量

见 `.env.example`。其中 OpenRouter、Tavily、Coze、Resend 等密钥必须只在后端环境使用。前后端共用 `APP_SESSION_SECRET` 验证签名登录会话，必须保持一致。`SITE_URL` 应是最终部署域名，用于邮件退订链接。
