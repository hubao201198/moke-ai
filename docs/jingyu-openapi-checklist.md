# 鲸域 OpenAPI 接入清单

核验时间：2026-08-26

## 已确认入口

- 官网：<https://jiyuen.cn/>
- 租户控制台：<https://console.ugiyu.com/>
- API 网关：`https://console-api.ugiyu.com`
- Swagger 页面：<https://console-api.ugiyu.com/doc.html>
- Swagger 分组：`CRM`

公开访问 `GET /swagger-resources` 可以看到 CRM 分组，但公开访问 `GET /v2/api-docs?group=CRM` 只返回项目元信息，不包含 `paths`、鉴权定义或 Webhook 说明。因此不能依据公开页面完成原生请求字段映射，也不能把第三方 XBot 接口当作鲸域官方接口。

## 采购账号时必须让鲸域提供

1. 租户专属 OpenAPI 文档或已授权的 Swagger 访问方式。
2. 生产 API 网关、鉴权方式、AppKey/AppSecret 或访问令牌。
3. 企业、租户、企微账号或 Bot 实例的标识字段。
4. 手机号/微信号检索与发起好友请求的接口、频率限制和风控规则。
5. 好友通过事件、收到私聊消息事件的 Webhook 地址配置方式和签名算法。
6. 文本消息发送接口；如支持图片、文件、朋友圈，请同时提供对应接口。
7. 测试租户、测试企微账号、IP 白名单要求以及生产开通流程。

## 提交给鲸域的回调地址

`https://maoke-ai.vercel.app/api/webhooks/jingyu`

回调必须支持签名校验和事件唯一 ID。未验证来源的回调不会执行自动发送；敏感内容进入人工审核。

## 本项目的配置项

```dotenv
JINGYU_PROTOCOL=jingyu-openapi
JINGYU_API_BASE=
JINGYU_API_KEY=
JINGYU_GUID=
JINGYU_WEBHOOK_SECRET=
JINGYU_AUTO_WELCOME=false
JINGYU_AUTO_REPLY_NORMAL=false
```

收到租户专属文档后，需要把原生鉴权、三个业务动作（加好友、欢迎语、私聊回复）和两类回调（好友通过、收到消息）映射到 `lib/jingyu.ts` 与 `app/api/webhooks/jingyu/route.ts`。在映射和沙箱验证完成前，不应开启自动发送开关。
