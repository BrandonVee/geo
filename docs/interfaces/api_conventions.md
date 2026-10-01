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

已发布订单的 `GET /v1/publication-orders/{orderId}/tracking-source` 要求完整品牌范围、`publication.read` 与 `resource.create`，返回订单 ID、标题及公开结果链接，不创建追踪或扣费。订单在其他范围不可见返回 404，尚未发布或已退稿返回 409，缺少有效 HTTP(S) 结果链接返回 422。

`GET /v1/publication-orders` 默认每页 20 条，上限 100 条；可按 `keyword`、`status` 及成对的 `beginDate`/`endDate` 筛选。`data` 保持订单数组，envelope 新增 `pagination`（`page`、`pageSize`、`total`、`pages`）；日期按北京时间计算，超出末页返回实际末页。只即时同步本次授权分页的履约状态，再读取最新匹配结果。

管理端 `GET /v1/admin/publication-orders` 同样默认 20 条、上限 100 条，按 `q`、企业、来源、状态和成对日期筛选；`data` 为 `{ list, pagination }`，行记录包含企业名称。列表和 `GET /v1/admin/publication-orders/{orderId}` 只读本地记录，都要求 `platform.publication.manage`，不调用上游或扣费；单笔读取用于人工处理响应丢失后核对已保存状态。人工交付的 `PATCH` 仅接受 HTTP(S) 结果链接，聚合订单仍拒绝手工结单。

账号 `PATCH /v1/admin/users/{userId}` 主动停用或把代理商调整为当前不可用时，会逐家校验有效企业管理员；`409 LAST_TENANT_ADMIN` 的 `details.organizations` 返回需交接企业的 ID 与名称，拒绝时不更新账号、Session 或功能范围。租户成员目录在成员 `status` 之外、平台企业详情的 `members` 在 `memberStatus` 之外返回 `accountState`（active/disabled/scheduled/expired），两者分别代表企业成员关系和全局账号当前可用状态。

企业 `GET /v1/admin/organizations` 支持企业/品牌名称、BrandID、企业 UUID 与内部标识的文字搜索，文字中的 `%`、`_` 与反斜杠按原文匹配。`status` 保留手动状态 active/suspended 的原义；`accessState` 区分服务正常 active、手动冻结 suspended、到期冻结 expired，手动冻结优先，空服务期限沿用原规则。行记录同时返回 `accessState` 与 `pointsExpired`，积分到期不改变服务状态。列表和总数从平台角色的同一只读快照读取，按接入时间与企业 ID 倒序排列，越界页码回退有效末页，空结果页码为 1。

`GET /v1/admin/organization-balances` 要求 `platform.balance.manage`，沿用企业目录的查询、状态和分页规则，并在同一快照返回 `balances`：`enterprisePoints`、`enterprisePublicationCny`、`brandPoints`、`brandPublicationCny`。积分为整数，人民币为分；品牌余额只取当前映射 BrandID，缺少账户返回零。普通企业目录不包含该字段。

`GET /v1/balance-transactions` 要求企业管理员的 `balance.read`，返回 `{ list, pagination }`，默认每页 20 条、上限 100 条；支持 `userId`、`asset`、`operation`、`beginDate` 和 `endDate` 取交集。日期按北京时间闭合范围，分页按创建时间与 ID 倒序；总数和明细使用同一租户只读快照，越界页码回退有效末页，行记录包括来源/目标 BrandID 和品牌名称。旧 `limit` 截断参数不再接受。`GET /v1/balance-transactions/actors` 要求相同权限，仅查询当前企业实际流水中的用户，可按 `q` 搜索姓名或账号、按 `userId` 核对已选用户，最多返回 20 位；文字通配符按原文匹配，历史停用或已移除成员保留可查。未指定品牌的 `GET /v1/balances` 同样只向企业管理员开放企业资金池；品牌角色必须传授权品牌及内部绑定。

`GET /v1/admin/balance-transactions` 要求同一余额管理权限，返回 `{ list, pagination }`，行记录增加可空 `sourceBrandId`、`targetBrandId` 标注账户流向。按企业、操作者、资产和操作类型取交集，列表与总数从同一只读快照读取，按创建时间与 ID 倒序排列，越界页码回退有效末页；关闭企业保留历史流水。

企业 `PATCH /v1/admin/organizations/{organizationId}` 只保存提交字段；可选 `expected` 提供原状态和原期限（历史空期限用 `null`），包含所有修改字段的原值，也可增加未修改字段校验。平台客户端始终传原值；行锁内不一致返回 `409 ORGANIZATION_SETTINGS_CONFLICT` 和 `details.current`，不变更也不审计。恢复仍到期的企业返回 `422 ORGANIZATION_SERVICE_EXPIRED`，可同时提交未来服务期限与 `status=active` 完成续期恢复；更新与审计在同一事务内提交。

## 响应格式

`POST /v1/balance-allocations` 要求 `balance.allocate` 及目标企业品牌归属，余额、流水、审计原子提交。相同键更改品牌、资产、金额、原因、操作者或操作类型返回 `409 IDEMPOTENCY_CONFLICT`；成功重放返回 200，不重复写审计或占代理商额度。`GET /v1/balance-allocations/confirmation` 接受 `organizationId`、`brandId` 和 `idempotencyKey`，要求相同划拨权限，使用租户数据库角色与同键事务锁，只返回当前操作者在指定品牌的原划拨（含 `brandId`）或 `null`，不返回其他用户或其他操作的流水。

`GET /v1/admin/balance-transactions/confirmation` 接受企业 UUID 与原幂等键，要求 `platform.balance.manage`，只读返回原流水（含账户 BrandID）或 `null`。平台入账和扣减的余额、流水与审计在同一事务提交；相同键的账户、资产、金额、原因、操作或操作者发生变化时返回 `409 IDEMPOTENCY_CONFLICT`，重放成功不重复审计。

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
| `409`             | 初始化、唯一键、状态机并发冲突或计费报价已变化               |
| `410`             | 已弃用且不再接受写入的兼容资源                               |
| `413`             | 请求体超过 4 MiB 上限（`PAYLOAD_TOO_LARGE`）                 |
| `415`             | 正文不是受支持的 UTF-8 JSON 媒体类型                         |
| `422`             | 请求格式正确但业务前置条件不满足，例如腾讯尚未接入或余额不足 |
| `429`             | 认证或接口限流                                               |
| `500`             | 未分类服务端错误                                             |
| `502`/`503`/`504` | 上游错误、系统依赖未就绪或上游超时                           |

## 幂等与并发

人工入账、品牌划拨、发布下单以及外部计费请求需要调用方提供或服务端生成稳定幂等键。相同企业范围内重复提交同一键应返回首次结果，而不是重复产生副作用。状态机更新以数据库当前状态为前置条件，失败使用 `409` 而非静默覆盖。

文章生成在企业范围内保存幂等键，并校验原操作者、品牌、内部绑定和请求内容；不一致返回 `409 ARTICLE_JOB_IDEMPOTENCY_CONFLICT`。任务、入队及提交审计原子完成，首次成功返回 `202`，重放或恢复旧的未入队任务返回 `200`；队列不可用返回 `503 ARTICLE_QUEUE_UNAVAILABLE`，不保留新建失败任务。旧任务恢复保留原请求和价格快照，执行中与已结束任务不会重新入队。网络失败重试必须继续使用同一个键，明确失败或取消的任务重新生成使用新键。

效果追踪 `POST /v1/answerbit/articles` 必须提供 `Idempotency-Key`。同一企业、原操作者、品牌、内部绑定和追踪内容重放返回原状态；内容不一致返回 `409 ARTICLE_TRACKING_IDEMPOTENCY_CONFLICT`。已创建的提交重放不重新报价、扣费或调用腾讯；新提交报价变化返回 `FEATURE_PRICE_CHANGED`，余额不足返回 402，均不保留半成品。首次腾讯成功返回 201，成功重放返回 200，正在处理、明确失败与结果不确定的提交状态返回 202，客户端必须检查 `data.status`，不能把 202 视为腾讯成功。failed/uncertain 已返还原积分；未确认状态不会自动重新创建。`GET /v1/answerbit/article-tracking-submissions` 只返回当前用户在当前品牌最近 20 次提交及原输入，支持恢复已获得 ArticleID 的本地收尾；文章追踪详情要求 ArticleID 属于当前范围的目录，否则返回 `404 ARTICLE_NOT_FOUND`。

文档新建和导入支持可选的 `Idempotency-Key` 请求头；工作台和平台文档库必须提供稳定键。首次创建返回 `201` 和 `data.replayed=false`，相同键、操作者、范围及创建内容重放返回当前文档、`200` 和 `data.replayed=true`，不新建版本；参数或操作者不一致返回 `409 CONTENT_DOCUMENT_IDEMPOTENCY_CONFLICT`。原始创建指纹不随后续编辑改变。兼容不带键的调用，但此类调用每次都是独立创建，不能安全重试。

个人视图创建支持可选 `Idempotency-Key`，工作台必须使用稳定键。键按企业和用户隔离，首次返回 201 和 `replayed=false`，相同创建内容重放返回当前视图、200 和 `replayed=true`；不同内容返回 `SAVED_VIEW_IDEMPOTENCY_CONFLICT`，原视图已删除返回 `SAVED_VIEW_REMOVED`，名称重复返回 `SAVED_VIEW_NAME_EXISTS`，均为409。修改可携带 `expected` 原名称、筛选和默认标记；并发冲突返回409 `SAVED_VIEW_VERSION_CONFLICT` 和 `details.current`，目标已达到则直接返回200。DELETE 和重复DELETE均返回204；内部创建键、指纹和删除标记不出现在视图响应中。

内容文件夹创建支持可选 `Idempotency-Key`，工作台与平台文章库使用稳定键。首次返回201与 `replayed=false`，原操作者、绑定、品牌和创建名称一致时重放返回当前文件夹、200与 `replayed=true`；不一致返回409 `CONTENT_FOLDER_IDEMPOTENCY_CONFLICT`，原文件夹已删除返回409 `CONTENT_FOLDER_REMOVED`，名称重复返回409 `CONTENT_FOLDER_EXISTS`。PATCH 正文和DELETE 查询支持 `expectedName`；名称已变化返回409 `CONTENT_FOLDER_VERSION_CONFLICT` 与 `details.current`，目标已达到的改名重试返回200。DELETE及重复DELETE均返回204；删除、文档解绑和新增版本快照、审计原子提交。列表和写入响应不包含内部创建键、指纹或删除标记。

`GET /v1/content-documents` 保留 `limit`（默认50、上限100）和 `offset`（0–100000）参数，以及 `data.list` / `data.total`。新增 `data.pagination` 返回 `page`、`pageSize`、`total`、`pages` 和实际 `offset`；有效的非整页偏移保持原值，偏移超出匹配结果时回退末页起点，空结果偏移为0、页码为1。列表与总数在租户角色的同一只读快照中获取，按更新时间及 ID 倒序；标题和正文搜索转义文字通配符，筛选按范围、目录、状态和来源取交集。文档详情与版本目录同样使用只读快照，文件夹名称只来自当前完整范围的活动目录。

文档编辑、归档和历史恢复的内容、版本及审计原子提交，失败不推进版本；写入响应不包含内部创建键和原指纹。历史恢复也使用422 `CONTENT_DOCUMENT_BODY_REQUIRED` / `CONTENT_DOCUMENT_SOURCE_URL_REQUIRED` 表达正文或来源校验失败。

文档编辑与历史恢复请求体、归档查询参数必须包含正整数 `expectedVersion`。版本不一致返回 `409 CONTENT_DOCUMENT_VERSION_CONFLICT` 和 `details.currentVersion`，不写入内容或版本；客户端保留未保存编辑，核对最新版后重新提交。

报告创建、额度、入队和审计原子提交，首次成功返回 201，原任务重放返回 200；额度不足返回 402 且不保留新建半成品。旧的不完整提交会补全原任务或返回明确失败的原任务，客户端可使用新键重新导出。报告导出同样校验原操作者、品牌、内部绑定、报告类型和完整筛选；不一致返回 `409 REPORT_EXPORT_IDEMPOTENCY_CONFLICT`。网络失败重试保留原键，确认失败或文件过期后按原条件重新导出使用新键。报告元数据返回规范化的原筛选、即时过期状态、下载地址和 `errorMessage`；元数据响应不包含 CSV 正文。

GET、PUT、DELETE 按 HTTP 语义保持幂等；POST 中具有财务或外部副作用的端点必须在契约中显式包含幂等语义。腾讯监控品牌扩容的上游契约未提供幂等键：明确返回 429 表示请求被拒绝，可按 `Retry-After` 有限退避；超时或 5xx 的结果不确定，服务端不自动重放，管理员应先刷新积分、配额和流水再决定是否再次提交。

通知 `PUT /v1/notification-rules/{ruleId}` 全量替换要求 `expected` 原始规则配置；并发配置变化返回 `409 NOTIFICATION_RULE_CONFLICT` 和 `details.current`，Worker 评估时间不参与冲突判断。创建以企业、类型、范围去重，相同原操作者与完整配置重放返回 200，首次创建返回 201；写入与审计原子提交。`PUT /v1/notifications/read-all` 接受企业及可选类型、严重程度、北京时间起止日期，返回 `{count}`，覆盖所有匹配页，仅为当前用户写入已读记录，不接受分页参数。

报告历史 `GET /v1/report-exports` 支持 `q`（文件名、报告编号、原关键词）、`reportType`、`status` 和北京时间 `beginDate`/`endDate` 提交日期，日期可单独使用。过期但未清理的成功文件归入 expired 筛选；列表与总数来自同一租户只读快照，按提交时间、ID 倒序稳定分页，页码超界回退。元数据不包含文件正文，读取权限仍为当前品牌的 `report.export`。

积分用量 `GET /v1/point-usage` 的余额、周期汇总、明细计数和分页读取来自同一只读快照；类型筛选不改变周期汇总。按时间和 ID 稳定倒序分页，页码超过末页时返回实际末页，空结果返回第一页，调用方使用 `data.pagination.page` 展示当前页。

## OpenAPI 维护

[OpenAPI 定义](./openapi.yaml) 是客户端生成和接口联调入口。新增、重命名或删除 API 时，同一变更必须更新 Route、共享契约、OpenAPI 与相关领域/集成文档。OpenAPI 中应包含安全方案、参数范围、成功响应和主要错误响应。Web 测试会双向比对 `apps/web/src/app/api` 的 Route、HTTP 方法与 OpenAPI；Better Auth 由单一 catch-all Route 承载多个已公开认证路径，是唯一允许的路径映射例外。

取消、申诉请求支持可选 UUID `actionRequestId`，客户端发送前保存编号；缺省由服务端生成。订单返回的 `providerAction` 是当前服务端操作记录，含原操作类型、操作者、开始与期限时间、状态及申诉内容。存在执行中或结果不确定操作时返回 `409 PUBLICATION_ACTION_RECONCILIATION_REQUIRED`，`error.details.action` 提供原记录；读取核对不重复写入上游。

`POST /api/v1/publication-orders/{orderId}/action-resolution` 接收企业、内部绑定、品牌、原 `actionId` 和非空 `note`（最多2000字）。要求当前品牌 `publication.create` 权限，企业与品牌不可越界。未超期执行中返回 `409 PUBLICATION_ACTION_IN_PROGRESS`，编号已变化返回状态冲突；结束只解除服务端待核对并审计，不取消订单、申诉或退款。已结束的相同编号返回原订单；结果不确定时应读取原订单确认，不自动重发。
