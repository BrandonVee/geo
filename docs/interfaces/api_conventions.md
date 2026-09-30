# API 约定

本文定义 AnswerBit GEO 自有 HTTP API 的统一资源路径、认证、请求校验、响应、错误和幂等约定；每个端点的字段与方法以同目录 OpenAPI 为准。

## 路径与版本

- 健康检查位于 `/api/health/live` 与 `/api/health/ready`，不纳入业务版本；
- Better Auth 端点位于 `/api/auth/*`；
- 业务 API 统一位于 `/api/v1/*`；
- URL 使用资源名而非动作名，集合与成员通过 HTTP 方法区分；
- 管理端全局资源置于 `/api/v1/admin/*`，租户资源在参数或请求体中明确 `organizationId`。

## 认证与授权

除健康检查和首次初始化状态/创建外，业务 API 依赖 Better Auth Session Cookie。Route 先解析 Session，再由 Service 验证平台权限、企业成员权限和品牌范围。认证通过不表示已授权；返回资源前必须完成对象级组织与品牌检查。

固定 Tencent TeamID 与统一 API Key 是系统业务就绪的全局前置条件。除平台腾讯配置读取/写入外，所有业务 API 在 Session 校验后确认统一配置状态为 `active`；未完成接入时返回 `422 PLATFORM_TENCENT_CONNECTION_REQUIRED`。腾讯配置 `PUT` 会在一次请求中完成上游验证、目录导入和企业投影；日常目录一致性由 Worker 自动维护，`POST /api/v1/admin/answerbit-enterprise-syncs` 只保留为运维诊断和兼容调用。平台监控品牌扩容由 `POST /api/v1/answerbit/metering/quota-purchases` 调用腾讯官方写接口，只有腾讯返回成功后才响应成功。

浏览器 `POST`、`PUT`、`PATCH`、`DELETE` 请求（包括 Better Auth POST）在 Session 查询和正文读取前统一校验 Origin；`APP_URL`、`BETTER_AUTH_URL` 或 `BETTER_AUTH_TRUSTED_ORIGINS` 中未登记的来源返回 `403 UNTRUSTED_ORIGIN`。显式登记的跨站前端可以写入；携带 `same-site`/`cross-site` 浏览器信号却缺少 Origin 的请求同样拒绝。没有 Origin 与 Fetch Metadata 的服务端调用继续使用 Session 和权限校验。部署到新域名时同时配置上述三项，不能通过放宽 Cookie 或代理改写来源绕过门禁。

## 请求与校验

JSON 请求使用 `Content-Type: application/json`；允许标准的 `application/*+json` 结构化后缀和可选 UTF-8 charset，其他媒体类型或非 UTF-8 charset 返回 `415 UNSUPPORTED_MEDIA_TYPE`。自有业务 API 通过共享流式解析器读取正文，按实际接收字节统一限制为 4 MiB；Better Auth POST 在保留其原生媒体类型和解析规则的前提下，也会先经同一字节上限再转交认证适配器。声明长度或实际正文超限均返回 `413 PAYLOAD_TOO_LARGE`，不会继续缓冲剩余正文。自有业务 API 的非空正文若不是合法 UTF-8 JSON，返回 `400 INVALID_JSON`；语法正确的值再交给 Zod `safeParse`，契约校验失败返回 `400 VALIDATION_ERROR` 和可选 `details`。共享输入 Schema 放在 `packages/contracts`，日期、分页、枚举、整数金额和 ID 的约束应由契约层表达，Service 不重复接受未校验的任意对象。

列表筛选显式传递 `organizationId`、`teamBindingId`、`brandId` 等范围参数。调用方不得用前端隐藏选项代替服务端范围校验。

## 响应格式

成功响应：

```json
{
  "data": {},
  "requestId": "REQUEST_ID"
}
```

失败响应：

```json
{
  "error": {
    "code": "STABLE_ERROR_CODE",
    "message": "可展示的信息",
    "details": []
  },
  "requestId": "REQUEST_ID"
}
```

`requestId` 用于日志、上游调用和故障关联。所有 API 均在 `X-Request-ID` 响应头中返回关联标识；自有 JSON 响应头必须与响应体一致，`204` 或文件下载等无 JSON envelope 的响应只通过响应头公开。Better Auth 的正常结果与已处理认证错误保留原生响应体，由适配层单独生成响应头标识；认证处理器抛出的未分类异常则转换为平台 `INTERNAL_ERROR` envelope，并使用同一标识记录结构化错误日志。创建资源通常返回 `201`；无响应体操作可返回 `204`；客户端不得只依据错误文案分支，应使用稳定 `error.code`。所有 `/api/*` 响应（包括成功、认证失败和其他错误）统一返回 `Cache-Control: no-store, max-age=0`，浏览器、CDN 和反向代理不得保存跨用户业务数据或陈旧状态。返回 `429` 且服务端已知等待窗口时，同时返回标准 `Retry-After` 秒数；认证端点保留 Better Auth 的 `X-Retry-After` 兼容头，但调用方统一读取 `Retry-After`。

## 状态码语义

| 状态码            | 语义                                                         |
| ----------------- | ------------------------------------------------------------ |
| `200`             | 查询或更新成功                                               |
| `201`             | 资源创建成功                                                 |
| `204`             | 操作成功且无响应体                                           |
| `400`             | 请求结构、类型或业务输入格式错误                             |
| `401`             | 缺少有效 Session                                             |
| `402`             | 腾讯能力积分不足，或平台内部资源权益未配置、名额已满         |
| `403`             | 已认证但缺少权限或数据范围                                   |
| `404`             | 资源不存在或对当前范围不可见                                 |
| `409`             | 初始化、唯一键、状态机并发冲突或计费报价已变化                 |
| `410`             | 已弃用且不再接受写入的兼容资源                               |
| `413`             | 请求体超过 4 MiB 上限（`PAYLOAD_TOO_LARGE`）                 |
| `415`             | 正文不是受支持的 UTF-8 JSON 媒体类型                         |
| `422`             | 请求格式正确但业务前置条件不满足，例如腾讯尚未接入或余额不足 |
| `429`             | 认证或接口限流                                               |
| `500`             | 未分类服务端错误                                             |
| `502`/`503`/`504` | 上游错误、系统依赖未就绪或上游超时                           |

## 幂等与并发

人工入账、品牌划拨、发布下单以及外部计费请求需要调用方提供或服务端生成稳定幂等键。相同企业范围内重复提交同一键应返回首次结果，而不是重复产生副作用。状态机更新以数据库当前状态为前置条件，失败使用 `409` 而非静默覆盖。

文章生成在企业范围内保存幂等键，并校验原操作者、品牌、内部绑定和请求内容；不一致返回 `409 ARTICLE_JOB_IDEMPOTENCY_CONFLICT`。网络失败重试必须继续使用同一个键，明确失败或取消的任务重新生成使用新键。

文档编辑与历史恢复请求体、归档查询参数必须包含正整数 `expectedVersion`。版本不一致返回 `409 CONTENT_DOCUMENT_VERSION_CONFLICT` 和 `details.currentVersion`，不写入内容或版本；客户端保留未保存编辑，核对最新版后重新提交。

报告导出同样校验原操作者、品牌、内部绑定、报告类型和完整筛选；不一致返回 `409 REPORT_EXPORT_IDEMPOTENCY_CONFLICT`。网络失败重试保留原键，确认失败或文件过期后按原条件重新导出使用新键。报告元数据返回规范化的原筛选、即时过期状态、下载地址和 `errorMessage`；元数据响应不包含 CSV 正文。

GET、PUT、DELETE 按 HTTP 语义保持幂等；POST 中具有财务或外部副作用的端点必须在契约中显式包含幂等语义。腾讯监控品牌扩容的上游契约未提供幂等键：明确返回 429 表示请求被拒绝，可按 `Retry-After` 有限退避；超时或 5xx 的结果不确定，服务端不自动重放，管理员应先刷新积分、配额和流水再决定是否再次提交。

## OpenAPI 维护

[OpenAPI 定义](./openapi.yaml) 是客户端生成和接口联调入口。新增、重命名或删除 API 时，同一变更必须更新 Route、共享契约、OpenAPI 与相关领域/集成文档。OpenAPI 中应包含安全方案、参数范围、成功响应和主要错误响应。Web 测试会双向比对 `apps/web/src/app/api` 的 Route、HTTP 方法与 OpenAPI；Better Auth 由单一 catch-all Route 承载多个已公开认证路径，是唯一允许的路径映射例外。
