# 腾讯 AnswerBit 集成

本文定义平台连接腾讯 AnswerBit 的统一凭证、企业品牌映射、调用校验、积分计费、日志与故障语义；具体 GEO 业务流程见领域文档。

<a id="shared_credential_model"></a>

## 导航

- [固定 TeamID 与统一凭证](#固定-teamid-与统一凭证)：平台接入与凭证边界。
- [调用解析与官方授权](#调用解析与官方授权)：凭证解析和访问校验。
- [品牌目录数据范围与自动同步](#品牌目录数据范围与自动同步)：企业投影与目录维护。
- [只读数据本地缓存与比对](#只读数据本地缓存与比对)：缓存命中和降级。
- [调用边界](#调用边界)、[响应与错误归一化](#响应与错误归一化)：上游协议与错误。
- [功能积分计费](#feature_billing)：完整业务功能结算。
- [管理 API](#管理-api)、[故障处理](#故障处理)：控制面与处置。
- [效果追踪写入恢复](#效果追踪写入恢复)：外部写入的幂等确认与结果不确定处理。

## 固定 TeamID 与统一凭证

上游基础地址由 `ANSWERBIT_BASE_URL` 配置，默认值为 `https://answerbit.qq.com`，且必须是无路径、查询参数、凭证或片段的 HTTP(S) Origin。平台管理员在 `/admin`“腾讯接入”只维护一组配置：固定 Tencent TeamID 和一把 API Key。系统直接调用代码中已接入的 AnswerBit OpenAPI，不在本地再配置 operation 白名单。

统一配置保存在 `platform_answerbit_credentials`。API Key 使用 `APP_ENCRYPTION_KEY` 和固定平台 AAD 做 AES-256-GCM 加密；读取接口只返回掩码、版本和健康时间。保存或轮换前必须实际调用 `/geo/query/brand` 校验 TeamID 与 Key。腾讯官方控制台是 Key 最终权限边界；平台不保存管理员选择的子集。TeamID 首次配置后固定不可更改，只允许轮换 API Key。

`platform_answerbit_credentials.permissions` 列仅为旧数据和旧客户端兼容保留。每次保存时由服务端自动写入完整 `answerBitOperations` 目录，运行时的统一凭证解析不读取该列做二次权限裁剪。

腾讯官方目录保存在 `platform_answerbit_brands`，它是平台企业的唯一来源。首次保存配置或轮换 Key 时，系统在同一请求中验证腾讯并导入已有 BrandID；通过官方接口新建品牌时则直接追加目录项。Worker 的 `tencent-enterprise-sync` 队列每日 03:00 UTC 核对完整目录；启动时仅在最近 20 小时没有成功核对时补查，因此在腾讯控制台直接创建或改名的品牌也会自动形成或更新平台投影。每个 BrandID 自动创建或更新内部 `organization` 投影，并建立配置操作者或当前有效平台管理员的初始 `tenant_admin`、内部 `answerbit_team_bindings`、托管连接占位记录、`answerbit_brand_mappings` 和默认资源权益。内部绑定与占位连接只服务现有外键、凭证解析和调用日志，不包含统一密钥副本，也不是页面或管理 API 中的业务资源；同一个固定 TeamID 可在不同企业出现，但 BrandID 与企业保持一一对应。

`organizations` 是腾讯企业在本平台的成员、权限、余额和业务数据租户投影，不是另一套可独立创建的企业目录。Tencent BrandID 是其上游来源和资源范围，两者保持概念区分及一一对应。租户端不能创建或改名企业，也不能查看或管理固定 TeamID 和内部绑定。

<a id="credential_resolution"></a>

## 调用解析与官方授权

Web Gateway 与 Worker 对每个实际 operation 独立解析凭证。业务输入包含企业、operation，并在品牌请求中包含 BrandID；服务端根据企业自动补充内部范围标识：

1. 读取平台统一配置；状态不是 `active` 时返回 `ANSWERBIT_KEY_NOT_CONFIGURED`；
2. 验证自动解析出的内部绑定使用固定 TeamID，否则返回 `ANSWERBIT_TEAM_SCOPE_MISMATCH`；
3. 品牌请求验证 BrandID 确实映射到当前企业，否则返回 `ANSWERBIT_KEY_SCOPE_MISMATCH`；
4. 确认 operation 属于代码内 `answerBitOperations` 接入目录，统一凭证不做本地子集授权校验；
5. 使用平台 AAD 解密统一 Key，并以企业占位 connectionId 写正常业务调用日志；若 Key 未获得对应权限，由腾讯上游返回 401/403 或业务错误。

新增上游能力时，代码将 operation 加入 `answerBitOperations` 目录并完成请求/响应校验；运维人员同时在腾讯官方控制台为该 Key 开通所需权限。当前目录覆盖 Apifox“AnswerBit”项目的 48 个已发布 operation，并保留官方 Web 客户端仍在使用、但未进入该 Apifox 项目的 `/geo/brand/get`、`/geo/brand/delete` 与 `/geo/billing/quota/purchase` 三个兼容 operation。平台管理页不提供 operation 选择器。

`answerbit_credential_assignments` 和按 TeamID Key API 仅保留迁移兼容。统一配置存在时，其写入返回 `410 ANSWERBIT_CREDENTIAL_MANAGEMENT_DEPRECATED`；尚未完成迁移的部署在单例没有 TeamID 时仍可临时使用旧 resolver。

<a id="enterprise_directory_sync"></a>

## 品牌目录数据范围与自动同步

`/geo/query/brand` 在固定 TeamID 下会返回腾讯团队的完整品牌目录。平台控制面读取已同步的本地目录；租户品牌列表直接读取当前企业的 `answerbit_brand_mappings`，不因每次打开页面再调用腾讯。企业管理员也只看到本企业 BrandID，不能因共享 TeamID 获得其他企业品牌。

配置保存和 Worker 自动任务会新增或更新官方目录项，为每个未删除 BrandID 自动创建或更新企业投影，并刷新统一配置及企业接入健康。平台不要求管理员日常点击同步；腾讯企业页每 60 秒刷新本地投影，运维诊断端点只触发同一目录同步编排且不接受 TeamID、Key 或企业参数。每个目录项通过 `missing_sync_count` 记录连续缺失次数：已投影品牌只有连续两次成功取得的完整目录都不再包含该 BrandID 时才关闭企业、内部范围绑定和连接；单次缺失只记录待确认状态。已由平台删除的企业保留关闭投影和映射作为删除标记，后续自动核对、运维同步或 Key 轮换验证不会将其重新创建或激活。支持 `brand_id` 的计量接口会自动使用当前企业绑定品牌，品牌积分排行在返回后再次按企业 BrandID 过滤。只支持 TeamID 的订阅、积分批次、订阅日志与配额调整属于统一腾讯账号级信息，只向拥有 `platform.answerbit.read` 的平台管理员返回；普通企业用户的周期用量响应也会移除其中附带的 TeamID 积分概况，避免共享 TeamID 暴露跨企业账务。

<a id="read_cache"></a>

## 只读数据本地缓存与比对

Web 对仪表盘指标、曝光/得分趋势与排行、域名/文章排行、问题/标题趋势、模型目录、文章标签和文章模板启用 PostgreSQL `answerbit_read_cache`。每次仍先完成企业、品牌与凭证校验；缓存键由应用版本、operation、企业、BrandID、凭证摘要及规范化的请求参数构成，避免不同范围或 Key 轮换后串用。对象字段顺序不影响键，筛选集合（平台、标题、竞品和标签 ID）排序归一化，其他数组顺序保留；仅实际请求腾讯时写 `answerbit_api_calls`。当前日期范围缓存 1 小时，历史日期范围和稳定目录缓存 24 小时；不同筛选条件各有独立条目。

多 Web 实例对同一缓存键使用 PostgreSQL 事务级 advisory lock 合并并发失效请求。腾讯返回成功后先按规范化 JSON 计算 SHA-256：内容未变化只延长检查与过期时间，变化时更新本地 JSON 快照；上游错误不覆盖成功快照。只有腾讯明确 429 且相同范围、相同凭证的成功快照不超过 7 天时才返回旧数据，并在至少 15 分钟的冷却窗口内停止重复请求该缓存键。任务状态、业务写入、实时计量与权限校验不走该缓存。浏览器 HTTP 响应仍是 `no-store`；持久缓存仅在服务端数据库内。

## 调用边界

`apps/web/src/server/integrations/answerbit/client.ts` 负责通用 HTTPS POST、请求头、超时和响应 envelope 校验；`modules/*` 负责各 operation 的请求/响应 Zod Schema；`credential-resolver.ts` 负责统一凭证与企业品牌范围解析；`gateway.ts` 负责调用和日志，接口层不结算积分；Service 与 Worker 在完整业务功能边界负责权限、租户上下文和一次性功能结算。

所有 AnswerBit 业务写操作必须先经过 Client/Gateway 请求腾讯官方 operation；Service 只在上游 `code === 0` 且响应 Schema 校验通过后写入本地 mapping/cache 和审计。上游拒绝、超时或响应非法时，本地不得单独创建、修改或删除对应映射。编辑腾讯品牌前先通过 `/geo/brand/get` 读取官方详情，校验品牌仍属于固定 TeamID，并在 `/geo/brand/update` 中保留官方 `default_language` 与商品关键词；官网按字符串数组提交，空描述和备注不发送。新建品牌未带初始化资源时调用 `/geo/brand/create`，带初始化问题或竞品时以固定 TeamID 调用 `/geo/brand/bundle/create`；Logo 通过独立的 `/geo/brand/update/icon` 请求更新，使基础资料和图片失败语义互不混淆。新建品牌附带 Logo 或独立更新 Logo 时，API 在调用腾讯前校验 Base64 编码、解码后不超过 2MB，并以文件签名核对 JPG、PNG、GIF、WebP 或 SVG 的声明 MIME；伪造格式和超限内容返回 `400 VALIDATION_ERROR`，不进入上游调用。

自动企业同步只在 `/geo/query/brand` 成功且响应完整通过校验后提交数据库变更，使用事务级 advisory lock 与凭证 `key_version` 防止 Key 轮换、平台写入和周期任务互相覆盖。超时、限流、5xx、业务码或非法响应均保留上一次成功目录；401/403 会把当前版本统一凭证及托管连接标记为 `invalid`。

请求包含 `Content-Type: application/json`、本次解析出的 `X-API-Key` 和贯穿自有 API、上游调用、日志与账本的 `X-Request-ID`。默认超时为 15 秒。Web 与 Worker 对上游 JSON 响应按解码后的实际接收字节统一限制为 16 MiB；声明长度或流式正文超限、非法 UTF-8 及 JSON 语法错误均归一化为 `invalid_response`，不会记录或透传原始正文；非成功 HTTP 响应的正文会立即取消，不占用连接继续下载。通用 Client 只对 timeout 和 5xx 按调用方指定次数退避重试；401/403、429、业务码错误和响应结构错误默认不自动重试。显式允许重试 429 的计量调用保留上游完整等待窗口用于最终 API 的标准 `Retry-After` 响应头，但单次进程内等待最多 5 秒，避免请求被异常上游值长期占用。

<a id="response_validation"></a>

## 响应与错误归一化

Web 通用 Client、Worker 业务调用与腾讯企业目录同步复用同一 envelope 校验器。AnswerBit 响应必须是对象，包含有限数字 `code` 与显式 `data`；可选 `msg` 只能是字符串。`code === 0` 后再由 operation 对应 Zod Schema 校验 `data`，缺字段或错误类型不会因 TypeScript 断言进入业务逻辑。异常归一化为 unauthorized、rate_limited、business、invalid_response、timeout 或 upstream，避免上游格式泄漏到页面；平台 API 的归一化错误详情保留 operation、HTTP 状态和业务码，便于通过 requestId 定位参数或权限问题。

Web 与 Worker 共用的品牌目录、仪表盘、文章生成和报表响应 Schema 位于 `@geo/contracts`。Worker 必须在写成功调用日志、生成文章内容、导出 CSV 或执行通知判定前完成对应 Schema 校验；校验失败统一记录 `ANSWERBIT_INVALID_RESPONSE`，不得把部分字段或类型强制转换后继续处理。

腾讯生产响应中，曝光与得分趋势的 `task_count` 可能是整数或十进制整数字符串；适配层统一转换为安全的非负整数后再交给 Service 和页面，其他格式继续按非法上游响应处理。

问题分组接口 `/geo/prompt/get/group` 的生产响应使用 `daily_avg_score[].avg_score` 表示每日平均得分，部分接口定义样例则使用 `score`；适配层同时接受两者并统一输出为 `score`。问题的 `created_time` 可能是非空日期/时间字符串或非负整数时间值，适配层统一转为字符串，其他格式继续按非法上游响应处理。监控问题列表接受逗号分隔的 `platforms` 查询参数并将其作为字符串数组传给该上游接口；可选值始终从 `/geo/team/get/filter_platforms` 读取，不接受页面自造模型标识。

批量创建监测问题 `/geo/prompt/create/batch` 必须为每个提交的问题返回唯一且非空的 ID，按上游顺序规范为字符串；少返回、多返回、重复或空 ID 均视为 `invalid_response`，不进入本地映射或成功审计，也不自动重试。前端按结果待核对保留原操作，使用实时目录确认后才继续写入。

文章列表接口 `/geo/article/query` 的生产响应可能将 `ref_count`、`ref_trends[].count`、`total` 与 `total_links` 返回为十进制整数字符串；适配层同时接受非负整数和纯数字字符串，并统一转换为安全整数后再写入本地映射或返回页面。

AI 内容页分别以 `tag_type=1` 和 `tag_type=2` 调用 `/geo/article/tag/get`，合并并按 `tag_id` 去重后分组展示用户标签与系统标签，避免依赖上游省略 `tag_type` 时的不明确默认行为。腾讯当前发布的 AnswerBit API 只提供标签查询，没有标签新增 operation。AI 生成表单因此允许用户直接输入平台内容标签并回车新增：这些名称保存在 `article_generation_jobs.tags`，用于生成内容库复用和展示，但不会伪装成腾讯 TagID；选择真实腾讯标签时仍把对应 `tag_id` 传给上游。效果追踪只能选择真实腾讯标签，也可以不选。

每次正常业务上游调用都会尝试写入 `answerbit_api_calls`，记录企业、企业占位连接、操作用户（系统任务为空）、operation、requestId、成功/失败/超时、上游业务码、HTTP 状态和耗时。选择阶段失败时没有真实调用，不伪造日志。腾讯配置验证与已有品牌导入不归属单个企业，因此只写平台审计，不写企业调用日志。日志不得记录 API Key 或完整敏感请求体。

调用日志属于可观测旁路：数据库日志写入失败时输出 `answerbit-api-call.log-failed` 结构化事件，但不改变已确定的上游成功/失败结果。接口调用不产生本地积分扣减或返还；完整功能结算失败使用 `feature-usage.restore-failed` 记录，运维人员按功能 referenceId 对账补偿。

<a id="feature_billing"></a>

## 功能积分计费

Gateway 和 Worker 的 `callAnswerBit` 只调用并记录 operation，不读取价格、不扣积分、不因单次接口失败处理积分。计费边界上移到业务功能：

1. `feature_point_costs` 按 `feature_code` 保存业务功能整数积分成本；
2. 业务入口用 `feature:<featureCode>:<referenceId>:consume` 对完整功能预扣一次；
3. 一个功能中的多个上游 operation、分页和重试不会增加扣减；
4. 完整功能失败时用 `feature:<featureCode>:<referenceId>:restore` 按原金额返还；
5. 登录用户或异步任务的 `requested_by` 写入功能扣减和返还流水；系统任务可为空；
6. API 调用日志继续记录真实 operation、状态、耗时和用户，仅用于运维观测。

积分是平台内部计费单位，与 AnswerBit 上游 subscription/credit 展示数据分离。平台管理员配置验证和导入已有品牌不扣减任何企业或品牌积分。

Apifox 计量中心的 9 个 `/geo/billing/*` operation 与其余 AnswerBit operation 一样不产生接口级本地积分。迁移 `0037` 将原 operation 价格表转换为功能价格表，只保留业务功能编码；管理接口为 `/v1/admin/feature-point-costs`。

官方 `/geo/billing/credit/status` 的顶层 `total_amount` 表示“当前可用积分”，`used_amount` 表示历史已确认消耗，页面和低积分通知直接使用 `total_amount`，不再二次减去 `used_amount`。使用率以 `used_amount / (total_amount + used_amount)` 展示；`credit_details.status=5` 的冻结批次保留在明细中，但不并入顶层可用积分。

腾讯计量能力已落地当前周期用量、订阅、积分状态与批次明细、消耗占比、每日趋势、品牌排行、积分流水、订阅日志和配额调整。周期查询支持用量类型筛选；积分流水支持周期、操作人/事件关键词与冻结/确认状态筛选；所有品牌型结果继续经过企业 BrandID 范围校验，品牌排行在服务端按当前企业授权集合过滤。这组上游数据在平台“腾讯计量”中供管理员跨企业选择品牌范围并查看共享腾讯账户；租户 `/dashboard/metering` 使用本地积分账本，不把共享 TeamID 的腾讯积分或订阅呈现为客户资产。

腾讯 Apifox 当前发布的九项计量 OpenAPI 均为只读接口；腾讯线上官方 Web 客户端同时使用未发布在该项目中的 `/geo/billing/quota/purchase`，请求体为固定 TeamID、`max_brand` 与增购数量。`/geo/billing/report/usage` 携带 BrandID 时只返回品牌级生成配额，不包含团队容量；平台扩容卡因此额外发起不携带 BrandID 的团队级查询，使用其 `max_brand.total_amount` 与 `used_amount` 展示当前容量上限、已创建品牌，并按 `max(0, total_amount - used_amount)` 计算当前可用配额和容量使用率，再随输入数量预览扩容后总容量与可用配额。普通计量视图仍使用携带 BrandID 的响应。扩容按官方前端规则以每个 400 积分估算 1–9999 个容量，使用 `/geo/billing/credit/status` 的实时可用积分计算预计剩余，确认后由服务端直接提交官方增购接口。只有腾讯业务码成功才显示扩容成功，本地不预写积分扣减或配额；随后重新读取积分、周期配额、积分流水和配额记录确认最终状态。

计量读取经过单进程串行节流，429 按腾讯 `Retry-After` 或指数退避有限重试；浏览器也顺序加载计量卡片，避免一次刷新并发冲击共享 TeamID。扩容写请求排入同一调用序列：429 明确拒绝时可以有限重试，超时和 5xx 因结果可能已生效而不自动重放。页面每 60 秒以及重新可见、恢复联网时补拉计量数据。

Apifox Schema 把计量时间字段声明为 Unix 整数，但当前腾讯生产响应会把同一批字段返回为十进制字符串，包括周期起止、重置/到期时间、流水与日志时间。适配层同时接受整数和纯数字字符串，并统一转换为安全整数后再进入 Service 与页面；其他任意字符串继续按非法上游响应处理。该兼容规则已用实际统一凭证对 9 个官方计量读取接口完成联调。

## 管理 API

- `GET /v1/admin/answerbit-configuration` 返回统一配置状态、Key 掩码、operation 目录、官方品牌目录及绑定统计；
- `PUT /v1/admin/answerbit-configuration` 验证并保存固定 TeamID 和新 API Key，同时刷新腾讯企业目录并生成缺失投影；
- `POST /v1/admin/answerbit-enterprise-syncs` 使用当前统一凭证立即创建并完成一次目录核对，返回目录数及新增、更新、关闭和待确认数量；该资源仅用于运维诊断和兼容调用，管理页不展示日常操作按钮；
- `POST /v1/admin/answerbit-brands` 在普通创建时调用腾讯 `/geo/brand/create`，附带初始化问题或竞品时调用 `/geo/brand/bundle/create`，再使用返回的真实 BrandID 更新目录并自动生成平台企业；
- `GET /v1/admin/answerbit-brands/{brandId}` 读取本地品牌目录、资料映射与对应平台企业投影，不请求腾讯或解密统一凭证；资料以最近一次成功创建、修改或目录同步的本地记录为准；
- `PATCH /v1/admin/answerbit-brands/{brandId}` 先读取官方详情并按上游字段契约调用腾讯 `/geo/brand/update`，成功后更新本地目录、映射和企业名称；
- `PUT /v1/admin/answerbit-brands/{brandId}/icon` 独立调用腾讯 `/geo/brand/update/icon` 更新品牌 Logo，并返回腾讯图片地址；
- `DELETE /v1/admin/answerbit-brands/{brandId}` 先调用腾讯 `/geo/brand/delete`，成功后关闭平台投影、内部范围绑定和连接，同时保留历史数据及删除标记；
- `GET /v1/admin/organizations` 只返回存在 Tencent BrandID 映射的企业投影；`POST` 及 `PUT /v1/admin/organizations/{organizationId}/answerbit-brand` 均固定返回 410；
- `/v1/admin/answerbit-credentials` 资源已弃用，只服务旧数据读取和统一配置启用前的迁移兼容。

企业管理员在 `/dashboard/settings/answerbit` 只读查看统一接入和本企业品牌状态。TeamID 与 Key 只在平台腾讯接入中由平台管理员维护，腾讯企业由平台管理员通过腾讯品牌接口管理，Key 的上游授权由腾讯官方控制台管理。

租户侧 `/v1/answerbit/brands` 的 `POST` 与 `/v1/answerbit/brands/{brandId}` 的 `PATCH` 固定返回 `410 ANSWERBIT_BRAND_PLATFORM_MANAGED`，避免绕过平台企业投影直接新增或改名腾讯品牌；租户仅保留按企业范围过滤后的品牌目录读取。

## 故障处理

| 现象                    | 处理                                                              |
| ----------------------- | ----------------------------------------------------------------- |
| 统一 Key 未配置或停用   | 返回 `ANSWERBIT_KEY_NOT_CONFIGURED`，平台管理员配置或轮换统一 Key |
| 企业绑定不是固定 TeamID | 返回 `ANSWERBIT_TEAM_SCOPE_MISMATCH`，检查企业创建或迁移数据      |
| BrandID 不属于企业      | 返回 `ANSWERBIT_KEY_SCOPE_MISMATCH`，检查企业与腾讯品牌映射       |
| 上游 401/403            | 标记统一配置与企业绑定异常，检查 Key、TeamID 和腾讯官方控制台授权 |
| 429                     | 保留 requestId，等待限流窗口，不做无界重试                        |
| timeout/5xx             | 有界退避重试；正常业务最终失败后返还积分                          |
| `code != 0`             | 按业务错误处理并返还积分                                          |
| 响应 Schema 不匹配      | 记录 `invalid_response`，返还积分并检查上游变更                   |
| 本地积分不足            | 在外部调用前结束，不向 AnswerBit 发请求                           |

平台管理员可通过 `/admin` 的调用健康视图按 operation、状态和时间排查。生产告警应关注统一凭证失效、上游 401/403、失败率、超时率和 P95 耗时。

## 效果追踪写入恢复

`/geo/article/trace/save` 未提供本系统可使用的上游幂等参数，创建调用不自动重试。平台以 `article_tracking_submissions` 保存客户端稳定键、加密原请求与真实结果：明确成功先持久化 ArticleID，再恢复本地映射和审计；Worker 也会补全已保存 ArticleID 的本地收尾，重放只返回原提交。明确拒绝、超时、5xx 或响应无法识别分别记录 failed/uncertain 并返还预扣积分，未知结果要求用户查询追踪目录核对，不再次调用创建。Worker 维护以及当前用户读取提交记录会把无 ArticleID、已中断一分钟的提交标记为待核对。具体页面流程见 [公开文章效果追踪](../domains/geo_operations.md#article_tracking)。

## 相关文档

- [GEO 运营域](../domains/geo_operations.md)
- [余额计费与发布履约](../domains/balance_and_publication.md)
- [ADR-0004：统一 AnswerBit 凭证直接调用已接入 OpenAPI](../decisions/adr_0004_direct_answerbit_operations.md)
- [ADR-0005：腾讯品牌目录作为平台企业唯一来源](../decisions/adr_0005_tencent_brand_enterprise_projection.md)
- [部署与运行手册](../operations/deployment_and_runbook.md)
