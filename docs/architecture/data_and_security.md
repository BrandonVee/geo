# 数据与安全架构

本文描述持久化数据分组、租户隔离、授权、凭证保护、事务完整性和审计边界；字段级定义以 `packages/db/src/schema.ts`、`packages/db/drizzle/v1.sql` 和后续增量迁移为准。

## 导航

- [数据分组](#数据分组)
- [租户隔离](#租户隔离)
- [授权模型](#授权模型)
- [凭证与会话](#凭证与会话)
- [完整性与幂等](#完整性与幂等)
- [审计与数据生命周期](#审计与数据生命周期)

## 数据分组

| 数据域               | 主要表                                                                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 身份与租户           | `users`、`sessions`、`accounts`、`organizations`、`organization_members`                                                                                                    |
| RBAC 与品牌范围      | `roles`、`permissions`、`role_permissions`、`member_roles`、`platform_user_roles`、`brand_access`、`organization_user_feature_scopes`                                       |
| AnswerBit 配置与映射 | `platform_answerbit_credentials`、`platform_answerbit_brands`、`answerbit_connections`、`answerbit_team_bindings`、各类业务 mapping                                         |
| 双余额与发布         | `balance_accounts`、`balance_transactions`、`feature_point_costs`、`platform_frog_credentials`、`publication_channels`、`publication_orders`                                |
| 平台资源额度         | `billing_plans`、`billing_plan_versions`、`platform_subscriptions`、`subscription_entitlements`、`quota_ledgers`                                                            |
| 工作流与用户数据     | `article_generation_jobs`、`article_tracking_submissions`、`content_folders`、`content_documents`、`content_document_versions`、`saved_views`、`report_exports`、通知相关表 |
| 可观测与审计         | `answerbit_api_calls`、`operation_logs`、`runtime_heartbeats`、`runtime_task_statuses`                                                                                      |
| 数据库发布状态       | `system_release_state`                                                                                                                                                      |

`billing_*` 与 subscription 表只承担平台内部资源限额和权益，不表示在线订单、收款或支付状态。

<a id="tenant_isolation"></a>

## 租户隔离

应用使用两类无登录数据库角色：`geo_tenant_app` 处理企业上下文，`geo_platform_app` 处理平台管理上下文。迁移为租户业务表启用 PostgreSQL RLS，应用通过事务级设置注入 `organization_id`、`user_id`、可选 `team_binding_id` 和 `brand_id`。

隔离要求：

- 租户 Repository 必须在 `withTenantDbContext` 的事务回调中执行；
- 平台管理 Repository 必须在 `withPlatformDbContext` 中执行；
- 业务查询仍显式携带组织和品牌条件，RLS 是第二道防线而非替代品；
- 迁移账号只用于迁移和受控维护，不作为生产 Web/Worker 的常规直连身份；
- 新租户表必须在同一迁移中评估策略、索引与 RLS 验证矩阵。

租户用户表仍只允许读取当前企业成员。历史资产流水通过 `tenant_balance_actors(text, uuid)` 的受限 `SECURITY DEFINER` 函数读取显示信息：只返回当前企业实际流水操作者的 ID、姓名和账号；当前调用用户必须仍是有效企业管理员，不返回邮箱、客户等级、凭证或其他企业用户。函数锁定 `search_path`，撤销 PUBLIC 执行权，只授予 `geo_tenant_app`；查询始终在租户上下文及只读事务中执行，成员被移除后历史显示不消失。HTTP Service 仍先校验企业状态、功能范围和管理员角色；函数不扩展普通用户表读取策略。

## 授权模型

平台权限、企业成员角色、企业功能范围和品牌范围分层表达。平台角色通过 `platform_user_roles` 授予；企业成员通过 `organization_members` 与 `member_roles` 关联；`organization_user_feature_scopes` 按目标企业收窄模块；品牌级可见范围通过 `brand_access` 限定。授权顺序为：有效 Session → 用户状态与代理商有效期 → 平台或企业角色权限 → 组织成员状态 → 企业功能范围 → 品牌范围。

`account_type` 用于区分管理员、代理商和客户账号类型，不替代 RBAC 权限判断。`users.agent_valid_from` 与 `users.agent_expires_at` 以及三个代理商额度字段只允许代理商使用；时间范围必须递增，额度必须非负。空开始时间表示立即生效，空结束时间表示长期有效，额度 `null` 表示不限。角色与权限种子是授权语义的来源，企业功能范围只与角色取交集而不产生提权。新增权限点应同时更新种子、核心权限—功能映射和接口测试。

本地品牌业务的统一授权还要求企业处于 active、内部 Team 绑定有效且属于企业、品牌映射属于该企业和 Team；企业管理员的全品牌权限不豁免归属校验。企业服务到期优先于积分有效期；正常授权与新任务检查 `service_expires_at`，积分业务再检查 `points_expires_at`。余额消费与人民币建单在事务中对企业读取共享锁后校验，续期或修改期限与消费串行协调；管理员手动扣减和既有退款不受服务到期阻止。

<a id="credential_encryption"></a>

## 凭证与会话

平台管理员可创建各类账号；具有成员管理权限的企业管理员可在添加成员时创建普通客户账号。客户账号、密码哈希、企业成员关系与本企业品牌权限在同一数据库事务内写入，企业端不能创建代理商或平台管理员。

用户密码由 Better Auth 以 scrypt 哈希保存到 `accounts`，服务端不保留明文。用户名规范化为小写并满足固定格式；系统关闭自行注册。Session 默认有效期 7 天，每 24 小时刷新；生产环境启用安全 Cookie。所有浏览器写请求在 Session 查询和正文解析前复用 Better Auth 的可信 Origin 集合，未知、空值、非法来源以及缺少 Origin 的同站/跨站浏览器请求返回 `403 UNTRUSTED_ORIGIN`；没有浏览器来源信号的服务端调用仍按 Session 与权限校验。Web 在 Next.js 响应边界为所有 `/api/*` 成功与错误响应以及所有 HTML 页面统一写入 `Cache-Control: no-store, max-age=0`，避免浏览器或共享代理保存认证结果、租户数据、动态运行状态或可复用的页面 nonce；静态构建资产继续使用长期不可变缓存。自有业务 API 只把 `application/json` 或 `application/*+json` 的 UTF-8 正文交给共享流式解析器；Better Auth POST 保留原生媒体解析，但同样先经过共享的流式字节上限。两类入口均核对声明长度和实际接收字节，超过 4 MiB 时立即停止读取并返回 `413 PAYLOAD_TOO_LARGE`；自有业务 API 的媒体类型错误返回 `415 UNSUPPORTED_MEDIA_TYPE`，以避免内容嗅探和无界正文缓冲。全站 CSP 把脚本、样式、连接、字体和 Worker 限定到业务所需来源，禁止对象、子框架、内联事件处理器和跨站表单目标；HTML 响应为每次请求生成独立 nonce，Next.js 框架脚本、主题初始化脚本以及 Ant Design 服务端和动态样式元素必须携带该 nonce。服务端样式注册器使用与 Ant Design 5 相同的 `@ant-design/cssinjs` 1.x 缓存，提取样式时显式写入 nonce；客户端页面切换继续使用当前 HTML 文档的 nonce，直到完整导航生成新文档。RSC 响应不重复插入带新请求 nonce 的服务端样式，由客户端缓存注册新组件样式。`@rc-component/portal` 的锁屏样式和 `rc-util` 的滚动条测量样式通过受版本控制的 pnpm 补丁读取当前文档 nonce，避免弹窗和抽屉滚动锁被拦截；升级该依赖时需复核补丁及浏览器 CSP 回归。脚本通过 `strict-dynamic` 信任其加载链，生产脚本和样式元素策略均不开放 `unsafe-inline`，脚本策略也不开放 `unsafe-eval`。现有 React 内联 `style` 属性由独立的 `style-src-attr` 兼容策略允许，不会放宽 `<style>` 元素；开发环境仅为热更新额外允许 eval、WebSocket 与本地 HTTP(S) 连接。

AnswerBit 只使用一组平台凭证。`platform_answerbit_credentials` 保存固定 TeamID 和 API Key 密文；密文使用独立平台 AAD 做 AES-256-GCM 加密。其 `permissions` 列只为迁移兼容保留，保存时自动写入全部已接入 operation，不参与统一凭证的运行时授权判断。`platform_answerbit_brands` 保存该 TeamID 的官方品牌目录，也是平台企业的唯一来源。完整密钥只在平台管理端提交，任何读取接口只返回掩码，统一配置表只授予平台数据库角色访问。

AES-256-GCM 密文使用 `版本.IV.认证标签.正文` 四段 envelope，后三段必须是无填充的规范 Base64URL；IV 固定为 96 位，认证标签固定为 128 位。解密会先验证段数、版本、编码和长度，再执行认证；格式损坏、密文篡改及 AAD 范围不匹配统一返回 `INVALID_SECRET_ENVELOPE`，不暴露底层密码库差异。加密主密钥本身也必须是规范 Base64 编码的 32 字节值。

媒体发布服务同样只使用一组平台凭证。`platform_frog_credentials` 保存基础地址、API Key 密文、指纹、掩码、版本和验证时间，使用独立平台 AAD 加密且只授予平台数据库角色访问；租户数据库角色无表权限。平台管理端保存前调用余额接口验证，读取接口不返回明文或密文。数据库网页配置优先于旧环境变量回退，Web 与 Worker 使用相同 `APP_ENCRYPTION_KEY` 解密同一记录。

保存配置、核对目录或官方创建品牌时，每个 BrandID 自动生成一个 `organizations` 租户投影，并创建默认资源权益。内部 slug 由 BrandID 的 SHA-256 摘要稳定派生，显示名称随腾讯目录更新。每家企业通过 `answerbit_team_bindings` 保留固定 TeamID 的本地范围，并在 `answerbit_brand_mappings` 绑定自己的 Tencent BrandID。TeamID 唯一约束为 `(organization_id, team_id)`，允许各企业复用同一固定值；BrandID 与 organization_id 分别受唯一约束，保证腾讯品牌不跨企业重复分配且每家企业只有一个上游品牌。对应 `answerbit_connections` 是外键与日志占位记录，不保存统一密钥副本。平台删除企业时先删除腾讯品牌，再将 organization 标记为 `closed` 并停用绑定和连接；映射与目录项作为删除标记保留，以承接历史关系并阻止目录核对重新创建。关闭投影及历史未映射 organization 不进入正常目录和授权路径。

Web Gateway 与 Worker 在验证企业绑定和 BrandID 归属后，使用平台 AAD 解密统一 Key 并直接调用已接入 OpenAPI；业务调用日志仍记录企业占位 connectionId。上游授权由腾讯官方控制台控制。企业管理员、代理商和普通成员不能创建、轮换或删除凭证，也不能停用或解绑固定 TeamID。`answerbit_credential_assignments` 与企业 AAD 密文仅保留旧多 Key 模型的迁移兼容，统一配置存在时不参与正常解析。

统一腾讯配置的 `team_id` 非空且状态为 `active` 是全局业务就绪条件。Session 校验之后，业务 API 和平台管理 Service 都再次验证该条件；只有腾讯配置读写显式跳过就绪门禁。未就绪时返回 `PLATFORM_TENCENT_CONNECTION_REQUIRED`，Dashboard 对平台管理员跳转到腾讯接入，对其他账号展示等待接入状态。

`runtime_heartbeats` 与 `runtime_task_statuses` 是平台级运行观测表，只授予 `geo_platform_app` 读写权限，不授予租户角色，也不包含组织或用户业务数据。Worker 使用启动时生成的实例 UUID 每 30 秒 upsert 心跳，平台只按最近更新时间推导在线、过期或离线状态；旧心跳最多保留 7 天，优雅退出会立即删除当前实例记录。周期任务状态使用任务名作为稳定主键并以 run ID 防止迟到完成覆盖新一轮状态，保留最近启动、成功、失败、耗时和错误码。这两张表不启用租户 RLS，因为租户角色没有对象权限，`db:rls-check` 同时验证租户拒绝和平台可读。

`system_release_state` 是平台只读的数据库发布门禁，分别记录 schema 与幂等种子的当前修订；schema 修订由迁移和紧随其后的版本记录步骤推进，seed 修订只在完整种子执行成功后推进。两类修订统一使用 `vN` 格式并按数字比较。Web readiness 通过 `geo_platform_app` 读取并确认修订不低于应用内要求的最低版本，更高修订保持旧应用 readiness 可用。迁移身份使用独立 `MIGRATION_DATABASE_URL`，运行实例不得持有发布权限。

数据库初始化历史以 `v1.sql` 表达清理后的基线，该脚本直接创建当时有效的表、枚举、约束、索引、触发器、RLS 和授权，不包含已删除表或中间 `ALTER/DROP` 过程；其 Drizzle 时间戳保留原 `0044_lively_shard` 的最终时间戳。基线末尾只恢复当前迁移会话的 `search_path`，确保 Drizzle 在同一连接中继续执行增量 SQL，不改变持久对象。`v2.sql` 追加平台媒体发布加密凭证表，`v3.sql` 追加客户价格等级、渠道采购成本、上游状态与固定售价表，`v4.sql` 追加品牌文档库、不可变文档版本、文件夹和发布来源关联，并回填已有成功生成内容。v5—v7 追加读取缓存、积分加价率和任务价格快照，v8 追加企业服务与积分到期日，v9 追加文档创建幂等键及原请求指纹，v10 追加效果追踪提交、加密请求及结果状态，v11 追加企业历史流水操作者的受限显示查询。全新数据库依次执行 v1—v11，并把 schema 修订推进为 `v11`；已经完整执行旧 0000—0044 迁移链或上一版 `0044_baseline` 的数据库按时间戳跳过基线建表，再执行后续版本。`record-schema-version` 校验对应结构；未完成旧 0044 迁移的历史数据库必须先用旧版本升级完整。

## 完整性与幂等

- 余额、订单和对应流水在同一数据库事务内变化；扣减使用数据库条件防止负数。
- 人工入账、品牌划拨、外部调用和返还均使用组织范围内的幂等键，并在余额事务开始时以事务级 advisory lock 串行化相同“企业 + 幂等键”的并发请求；发布订单使用同范围唯一键和事务约束。
- 发布状态更新限定合法前态并使用条件更新，终态不可再次推进。
- 首次管理员创建使用 advisory transaction lock，保证整个部署只成功一次。
- 异步任务执行前重新读取主体、租户和品牌权限，不信任陈旧任务载荷。报告和文章的业务记录、pg-boss 任务及创建审计共享同一 PostgreSQL 连接与事务，中途失败一起回滚，报告同时预留资源额度。资源额度预留校验稳定键对应的权益、数量、引用及已记录的操作人；确认和释放使用相同预留锁且互斥，不能重复结算或占用另一任务的预留。
- `article_generation_jobs` 与 `report_exports` 使用每次领取时生成的 `execution_id` 作为执行租约；中间态、成功和失败更新都必须匹配当前租约，恢复任务清空旧租约后，迟到 Worker 不再有写权限。
- `article_tracking_submissions` 保存企业、品牌、内部绑定、原操作者和加密请求，并启用企业 RLS；Service 只返回当前操作者在授权品牌的提交。提交与积分预扣原子写入，企业与键的事务锁避免并发重发；上游成功 ArticleID 单独持久化后可恢复映射和成功审计。失败/结果不确定状态与返还同一事务提交，后台维护不自动调用外部创建。迟到成功保留已返还事实，不额外收费。
- 内容文档、版本和文件夹均保存 `organization_id` 并启用租户 RLS；文档同时保存内部团队绑定与品牌范围。手工创建和导入使用 `(organization_id, creation_key)` 唯一约束及事务级 advisory lock 保证并发重放只创建一份文档与首版，创建审计与内容同一事务写入，原请求指纹用于拒绝不同内容或操作者重用同一键。AI 生成任务通过唯一 `source_job_id` 最多自动入库一次，文档版本使用 `(document_id, version)` 唯一约束并在事务锁内单调递增。
- 异步恢复由 PostgreSQL advisory lock 保证同一时刻只有一个扫描器。文章功能扣减与返还使用同一 reference 的稳定幂等键；计费维护还会扫描已失败或取消但缺失返还的文章任务，按原扣款金额补齐一次返还。

## 审计与数据生命周期

平台敏感操作写入 `operation_logs`；AnswerBit 调用记录企业、操作用户、operation、状态、上游业务码、HTTP 状态和耗时，但不记录密钥。登录用户发起的完整计费功能把用户写入扣减与返还流水；AnswerBit 同步调用和用户提交的异步任务把发起用户写入调用日志；平台周期任务和升级前历史记录允许操作用户为空。流水和调用健康查询在授权后关联用户显示名称和账号，但不复制凭证信息。余额流水是不可变业务凭证，不通过修改历史记录“修正”余额，应使用新的补偿流水。AnswerBit 调用日志是可观测旁路，写入失败只输出结构化事件，不能改变上游结果或积分结算。

报告文件最多包含 10,000 行，并在 24 小时后由维护任务清理。会话在用户停用时撤销；备份与恢复流程见 [部署与运行手册](../operations/deployment_and_runbook.md)。
