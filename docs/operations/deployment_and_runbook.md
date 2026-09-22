# 部署与运行手册

本文规定生产部署单元、配置、迁移、健康检查、备份、安全检查和常见故障处置，供发布与值班人员使用；云厂商资源编排细节由具体环境配置负责。

## 导航

- [部署单元](#部署单元)
- [持续集成门禁](#持续集成门禁)
- [发布顺序](#发布顺序)
- [健康与观测](#健康与观测)
- [备份与恢复](#备份与恢复)
- [故障处置](#故障处置)
- [安全检查](#安全检查)

## 部署单元

生产环境至少包含：

1. PostgreSQL 18 兼容实例，持久化业务数据与 pg-boss 队列；
2. Redis 8 兼容实例，承载 Better Auth 会话缓存和分布式登录限流；
3. 一个或多个 Web 实例，以 Next.js standalone 产物运行；
4. 至少一个 Worker 实例，以构建后的 `apps/worker/dist/index.mjs` 运行；
5. 每个版本执行一次的数据库发布任务，使用独立迁移身份；
6. TLS 终止与反向代理，将公共流量只转发到 Web。

Web 与 Worker 应使用同一数据库、AnswerBit 地址和 32 字节 Base64 加密主密钥；Web 另外通过 `REDIS_URL` 接入 Redis。小青蛙聚合发布在部署完成后由平台管理员进入“发布履约”填写 API 地址和 Key，系统验证后把 Key 加密保存到 PostgreSQL，Web 与 Worker 通过共享数据库和 `APP_ENCRYPTION_KEY` 使用同一配置。`FROG_PUBLICATION_BASE_URL` 与 `FROG_PUBLICATION_API_KEY` 只为旧部署兼容保留；数据库尚无网页配置时才回退使用。`APP_URL`、`BETTER_AUTH_URL`、trusted origins 必须配置为生产域名；`NODE_ENV=production` 以启用安全 Cookie。Web 启动路径统一读取 `packages/config` 的 Web schema，Worker 启动时读取不含认证与 Redis 字段的 Worker schema；数据库/Redis 协议、密钥编码、URL、可信 Origin 和版本标识不合法时不得进入正常服务。

单机自托管可直接运行 `pnpm install:docker`，由交互式引导生成 `.env.production` 并使用 `docker-compose.production.yml` 构建和启动。该 Compose 支持内置 PostgreSQL/Redis 与外部托管连接两种模式，详细步骤见 [Docker 安装引导](./docker_installation.md)。

每个 Web/Worker 进程使用一个 Drizzle/pg 业务连接池和一个按需或常驻的 pg-boss 连接池。`DB_POOL_MAX` 默认 10，`JOB_DB_POOL_MAX` 默认 5；业务连接默认 5 秒建连超时、30 秒查询超时、30 秒空闲回收和 300 秒最长生命周期。规划 PostgreSQL `max_connections` 时至少按 `(Web 副本数 + Worker 副本数) × (DB_POOL_MAX + JOB_DB_POOL_MAX)` 计算应用上界，再为发布任务、管理连接、监控和故障切换保留余量。所有连接使用 `DB_APPLICATION_NAME` 标识，三个容器目标分别提供可覆盖的默认名称。

生产镜像应设置 `APP_VERSION` 为可追溯的版本号或提交摘要。Worker 将该值与实例 UUID 写入运行心跳，便于确认滚动发布后是否仍有旧版本实例存活。

根目录多阶段 `Dockerfile` 生成三个彼此独立的非 root 镜像：

```bash
docker build --target release -t REGISTRY/answerbit-geo-release:VERSION .
docker build --target web -t REGISTRY/answerbit-geo-web:VERSION .
docker build --target worker -t REGISTRY/answerbit-geo-worker:VERSION .
```

`release` 目标只包含数据库包、核心包、配置包及执行迁移、版本记录、种子和 RLS 检查所需依赖；它要求运行时注入 `MIGRATION_DATABASE_URL`，先校验数据库发布配置，再按固定顺序执行迁移、记录 schema 版本、种子与 RLS 检查，任一步失败即非零退出。只读根文件系统下为 `/tmp` 挂载临时可写目录，任务完成后不保持常驻。`web` 目标只包含 Next.js standalone 服务端与静态资源，内置 `/api/health/ready` 容器健康检查；`worker` 目标只包含带 source map 的 Node.js bundle，通过进程状态和平台 Worker 心跳观测。

镜像构建阶段只使用不可用于运行的占位配置完成静态分析，真实运行 `DATABASE_URL`、迁移 `MIGRATION_DATABASE_URL`、认证密钥、加密主密钥和腾讯地址必须由运行环境注入，禁止写入 build args、镜像层或前端变量。数据库迁移、种子和 RLS 检查不在 Web/Worker 容器启动时自动执行；`MIGRATION_DATABASE_URL` 不得注入 Web 或 Worker。

当前仓库用 `packages/db/drizzle/v1.sql` 表达初始数据库基线，`v2.sql` 增加网页保存的小青蛙平台凭证，`v3.sql` 增加客户价格等级与渠道成本/售价，`v4.sql` 增加品牌文档库、不可变版本、文件夹和发布来源关联，并回填已有成功生成内容。全新环境依次执行 v1—v4；已完整应用旧 0000—0044 迁移链或 `0044_baseline` 的环境依据保留的最终时间戳跳过基线建表，再执行后续版本。版本记录步骤校验当前结构并把 schema 修订推进为 `v4`，种子修订推进为 `v2`。切换前必须确认历史库已经执行 `0044_lively_shard`；不得在发布任务之外手工清空或篡改 `drizzle.__drizzle_migrations`。未完整升级的历史库先使用旧版本补齐迁移。新结构变更继续追加迁移并递增 `vN` 发布修订。

## 持续集成门禁

`.github/workflows/ci.yml` 在 push、pull request 和手工触发时执行三层门禁：

1. Quality gate 使用锁文件安装依赖，依次执行格式、类型/lint、单元测试和完整构建；本地等价命令为 `pnpm verify`。
2. Database release gate 在一次性 PostgreSQL 18 与 Redis 8 环境完整执行两次 `pnpm db:release`，验证迁移、版本记录、种子、RLS 与整个发布流程的幂等性；随后启用真实 PostgreSQL 事务回归，覆盖发布单并发幂等扣款、退款、零元订单和迟到上游状态隔离；最后按生产镜像布局启动 Web standalone 产物，执行 `pnpm smoke:web` 验证存活、就绪、初始化入口、安全响应头和静态资源可读性，以 Chromium 完成首次管理员初始化、错误登录、成功登录和路由守卫验收，并使用 axe-core 阻止初始化、登录及腾讯接入页面出现 serious/critical 级 WCAG 2/2.1 A、AA 问题；Worker bundle 同时验证队列注册、初始维护、运行心跳及优雅退出。
3. Container matrix 分别构建 `release`、`web`、`worker` 目标并检查最终镜像用户为 `node`。

外部 GitHub Actions 使用不可变提交摘要固定，`.github/dependabot.yml` 每周为 pnpm 工作区、Actions 与 Docker 基础镜像提出独立更新。CI 只使用一次性占位密钥和本地服务数据库，不读取生产 Secrets。保护分支应把 Quality gate、Database release gate 和三个 Container 检查设为必需状态；只有全部通过的提交才能进入镜像发布流程。

## 发布顺序

1. 备份数据库并记录当前应用版本；
2. 安装锁文件固定的依赖并执行 `pnpm build`，或从同一版本构建 `release`、`web`、`worker` 三个镜像；
3. 使用该版本的 release 镜像和独立迁移身份执行一次性数据库发布任务；本地/裸机等价命令为 `pnpm db:release`；
4. 确认任务依次输出 `validate`、`migrate`、`record-schema-version`、`seed`、`rls-check` 成功并以 0 退出；该步骤会单调推进 `system_release_state` 中的 schema 与 seed `vN` 修订；
5. 向镜像仓库推送同一 `VERSION` 的三个镜像，滚动发布 Web，再发布 Worker；
6. 等待 Web readiness 通过，并检查 live、登录、核心读请求、Worker 心跳和队列消费；
7. 保留可回滚应用镜像。数据库回滚优先采用向前修复迁移，禁止直接删除生产数据结构；readiness 接受高于应用最低要求的修订，因此向后兼容迁移不会阻止旧应用重新接流。

Docker 一次性发布任务示例：

```bash
docker run --rm \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL --security-opt no-new-privileges \
  -e MIGRATION_DATABASE_URL \
  REGISTRY/answerbit-geo-release:VERSION
```

编排平台应把它建模为串行的 Job/init release phase，而不是每个 Web/Worker 副本各执行一次。任务日志不输出数据库 URL；迁移凭证从密钥管理系统短时注入并在任务结束后撤销或轮换。

首次环境还需访问 `/setup` 创建唯一首个管理员。完成后验证 `/setup` 不再允许创建账号。

## 健康与观测

- `GET /api/health/live`：进程存活，返回 `200` 和 `status: ok`；
- `GET /api/health/ready`：依次校验完整 Web 运行配置、执行 `select 1` 检查数据库、执行 Redis `PING`，再以平台只读角色确认 `system_release_state` 的 schema 与 seed 修订不低于应用要求；配置无效返回 `503 CONFIGURATION_INVALID`，数据库或 Redis 不可用返回 `503 DEPENDENCY_UNAVAILABLE`，迁移缺失/版本过低/发布状态不可读返回 `503 DATABASE_SCHEMA_NOT_READY`，种子版本过低返回 `503 DATABASE_SEED_NOT_READY`，所有错误均不返回敏感字段或原始校验详情；
- Web 容器的 Docker healthcheck 调用 readiness；负载均衡器与编排平台也应使用 readiness 接流，不能仅以容器进程存活作为可服务依据；
- Web 结构化错误日志包含 `requestId`；
- `database.pool-error` 记录业务连接池空闲连接异常，`job-database.error` 记录 pg-boss 数据库异常；两者只输出稳定事件、组件和数据库错误码，不输出连接串；
- `answerbit_api_calls` 提供企业、操作用户、operation、成功/失败/超时、上游状态和耗时；
- `answerbit-api-call.log-failed` 表示调用结果日志未落库；`feature-usage.restore-failed` 表示完整功能失败后的即时积分返还未落库，必须分别按 requestId 或功能 referenceId 告警。计费维护会继续扫描失败或取消的文章任务并按原扣款幂等补还，运维仍应核对最终账本；
- `operation_logs` 提供管理员和企业敏感操作审计；
- `runtime_heartbeats` 记录每个 Worker 实例的启动时间、版本与最近心跳。Worker 每 30 秒更新一次；平台控制台只把 90 秒内的记录计为在线，启用通知规则超过 30 分钟未评估时标记过期。优雅退出会删除当前实例行，异常退出由心跳超时识别；7 天前的旧 Worker 记录在下次启动时清理。
- `runtime_task_statuses` 记录计费维护、异步任务恢复、通知评估、腾讯企业同步和聚合发布同步的当前 run ID、执行实例、最近启动/成功/失败、耗时和稳定错误码。聚合发布同步每 5 分钟核对订单，同时只在渠道缓存超过 30 分钟或网页 Key 更新后同步一次完整渠道目录；页面分页读取不会触发目录刷新。平台将失败、执行超时、超过两个调度周期未成功和未上报显示为异常；旧执行完成时因 run ID 不匹配不能覆盖新状态。`runtime-task-tracking.failed` 只表示观测写入失败，原任务仍按自己的结果完成或失败。
- 平台总览直接统计文章与报告的等待、执行、24 小时失败和过期数量；`queued` 超过 10 分钟或 `running` 超过 15 分钟视为过期。`async-job-reconciliation.completed` 应至少每 5 分钟出现一次，`requeuedArticles`、`uncertainArticles`、`requeuedReports`、`activeJobs`、`races` 与 `errors` 用于判断恢复效果；`ASYNC_JOB_RECONCILIATION_PARTIAL_FAILURE` 或 `async-job-reconciliation.item-failed` 需要按任务 ID 排查。
- pg-boss 表与 Worker 日志用于判断文章、报告、通知、腾讯企业自动同步和维护队列是否积压；`tencent-enterprise-sync.completed` 应至少每 5 分钟出现一次，`last_synced_at` 随成功同步推进；`notification-evaluation.completed` 应至少每 15 分钟出现一次，其 `evaluated`、`emitted`、`failed` 字段用于判断本轮规则覆盖和失败数量，规则表的 `last_evaluated_at`、`last_evaluation_error` 用于定位单条持续检测故障。

建议告警：ready 连续失败、Web 5xx、`database.pool-error`/`job-database.error`、`redis.client-error`、AnswerBit 超时/失败率、Worker 无心跳或队列积压、连接池等待、PostgreSQL 连接占用/锁等待、Redis 内存与连接数、磁盘空间、企业余额异常增长。

## 备份与恢复

至少对 PostgreSQL 执行加密的周期全量备份与可恢复性演练。恢复步骤：

Redis 可启用 AOF 并纳入基础设施备份，但它只承载登录限流和会话缓存；持久 Session 与业务数据以 PostgreSQL 为准，Redis 丢失时不应从缓存反向覆盖数据库。

1. 隔离写流量并记录故障窗口；
2. 在独立实例恢复指定恢复点的备份，使用目标应用版本的 release 镜像完成数据库发布，并验证 `system_release_state`；
3. 检查用户、组织、余额流水、发布单、固定 TeamID 的统一 AnswerBit 密文、官方权限、品牌目录与企业 BrandID 映射，以及 pg-boss 任务；
4. 使用同一 `APP_ENCRYPTION_KEY` 验证统一 AnswerBit Key 与小青蛙 Key 密文可解密；
5. 运行 RLS 检查与应用冒烟；
6. 切换流量后监控重复任务和幂等流水。

`APP_ENCRYPTION_KEY` 必须独立备份；丢失该密钥会使平台统一 AnswerBit Key 与小青蛙 Key 密文失去可用性，并影响全部企业。报告导出文件是短期派生物，不作为核心恢复来源。

## 故障处置

### readiness 失败

先根据稳定错误码区分问题：`CONFIGURATION_INVALID` 检查 `DATABASE_URL`/`REDIS_URL` 协议、连接池容量/超时/生命周期、32 字节 Base64 `APP_ENCRYPTION_KEY`、认证密钥长度、公共 URL、可信 Origin 和 AnswerBit URL；`DEPENDENCY_UNAVAILABLE` 检查 PostgreSQL 与 Redis 可达性、连接数和服务日志；`DATABASE_SCHEMA_NOT_READY` 检查 release Job 是否使用当前版本成功完成 migrate、平台角色能否读取发布状态以及当前 schema 修订；`DATABASE_SEED_NOT_READY` 重新执行当前版本幂等 seed 并核对 seed 修订。恢复前不把仅 live 成功的实例加入流量，不通过手工更新 `system_release_state` 绕过发布任务。

### 数据库发布失败

先按 `database-release.step-failed` 的 `step` 定位 validate、migrate、record-schema-version、seed 或 rls-check。validate 失败时根据 `database-release.configuration-invalid` 的字段列表修正发布配置；迁移失败时停止应用滚动并保留日志与数据库备份；版本记录失败时检查历史库是否已完整到达旧 0044 结构，不能手工把不完整结构标记为 v1；种子失败可在修复后重跑整个幂等发布任务；RLS 检查失败时视为安全门禁失败，不发布 Web/Worker。确认使用的是目标 `VERSION` 的 release 镜像和独立 `MIGRATION_DATABASE_URL`，不得改用 Web/Worker 的运行连接串继续尝试。

### 首次初始化失败

- `SYSTEM_NOT_READY`：执行种子并确认 `super_admin` 角色存在；
- `SYSTEM_ALREADY_INITIALIZED`：确认已有 credential 账号并转到登录；
- 并发请求中只有一次 `201` 属于正常行为。

### 登录失败

检查用户名规范化、用户 `status`、Better Auth secret/base URL/trusted origins、浏览器 Cookie 与认证限流。停用账号拒绝登录是预期行为。

### AnswerBit 调用失败

用响应 `requestId` 查询 `answerbit_api_calls`，结合企业和操作用户区分凭证、限流、业务码、非法响应、超时和 5xx。接口调用本身不对应积分返还流水；确认完整计费功能失败时存在对应返还，同一功能 referenceId 不得手工重复返还。若结构化日志出现 `answerbit-api-call.log-failed`，以应用日志和上游 requestId 补查实际结果；出现 `feature-usage.restore-failed` 时，先按幂等键确认账本不存在返还，再创建受审计的补偿流水。持续 401/403 时由平台管理员轮换或重新验证统一 Key。

### 余额或发布异常

按企业、资产、品牌、reference 和 idempotency key 核对 `balance_transactions`，不要直接改历史流水。发布失败/取消应存在唯一 restore 流水；状态冲突先确认当前订单终态，再决定是否创建人工调整记录。聚合投稿出现 `FROG_PUBLICATION_RESULT_UNCERTAIN` 时，先用本地订单的 `provider_order_id`、`third_id` 和上游后台核对是否已建单；结果未确认前不重复投稿或人工退款。`frog-publication.channels.refresh-failed` 使用最近缓存，`frog-publication.orders.sync-failed` 表示本轮状态未推进，可在恢复上游后刷新发布订单重试只读查询。后台 `publication-reconciliation` 每 5 分钟同步；`publication-reconciliation.completed` 报告 checked/errors，部分失败码为 `PUBLICATION_RECONCILIATION_PARTIAL_FAILURE`。未配置 Key 时任务跳过，上报成功不等于已同步订单；确认 Web、Worker 均注入同一 Key。管理员不得通过人工渠道状态入口处理聚合订单。

### Worker 积压

先在平台“运营总览”或“运行与审计”检查在线 Worker 数、最近心跳、5 项周期任务以及文章/报告队列分布。最近心跳超过 90 秒或没有心跳时，确认 Worker 进程、`APP_VERSION`、数据库连接、当前数据库基线/增量迁移状态以及 `runtime_heartbeats`、`runtime_task_statuses` 写权限；同时检查 `runtime-heartbeat.failed` 与 `runtime-task-tracking.failed` 日志。进程恢复后应在 30 秒内出现新心跳，并在启动任务完成后看到周期任务最近成功时间推进。

Worker 在线但存在过期异步任务时，先查看“异步任务恢复”任务卡和 `async-job-reconciliation.*` 日志，再核对业务任务的 `status`、`updated_at`、`execution_id`、`queue_job_id` 与 pg-boss 状态。恢复器会跳过仍为 created/retry/active 的队列任务；其他安全任务自动重新投递。`ARTICLE_RECOVERY_UNCERTAIN` 表示文章可能已在腾讯创建但本地没有 ArticleID，系统会退款且不会自动重建，应按调用日志和腾讯后台人工核对后再由用户决定是否新建。不要手工清除正在执行的 `execution_id`，也不要绕过状态机直接修改终态。报告恢复后仍会重新检查有效企业、成员、团队、品牌权限和额度。

通知长时间没有推进时，先确认 `notification-evaluation` 定时任务和消费进程，再按 `notification-evaluation.completed` 的 `failed` 数量查询规则 `last_evaluation_error`。连接失败规则会主动调用品牌目录接口并读取最近调用历史；warning 在配置阈值触发，critical 在 `max(阈值 × 2, 5)` 次连续失败时触发。通知发布受规则级事务锁、唯一事件键和冷却窗口保护，不应通过手工插入通知补偿；根因解除后保留规则启用，等待下一周期重新评估。

腾讯企业目录长时间未更新时，先在“运行与审计”检查 `tencent-enterprise-sync` 最近成功时间、Worker 心跳、队列和 `tencent-enterprise-sync.failed` 日志；恢复 Worker 后会在启动时立即补做一次同步。确需绕过调度核对时，运维人员可调用 `POST /api/v1/admin/answerbit-enterprise-syncs`，该资源不作为日常页面操作。限流、超时、5xx 和非法响应不会覆盖上一次成功目录；401/403 会把当前统一凭证标记为异常，应在平台“腾讯接入”轮换或重新验证 Key。直接在腾讯删除的品牌需要连续两次成功目录核对后才关闭本地企业投影。

## 安全检查

- 数据库应用角色无登录权限，Web/Worker 不使用迁移超级权限；
- 数据库发布使用短时注入的独立迁移身份，`MIGRATION_DATABASE_URL` 不进入 Web/Worker 环境；
- CI 第三方 Action 固定到不可变提交摘要，依赖升级通过 Dependabot PR 和完整门禁审查；
- 生产密钥来自密钥管理系统，不写入镜像、日志或仓库；
- TLS、Secure Cookie、可信 Origin 和最小网络访问已启用；
- Web 响应保留 `nosniff`、`DENY` 防嵌入、严格 Referrer Policy、禁用摄像头/麦克风/定位的 Permissions Policy，以及生产 HSTS；反向代理不得删除这些响应头，`X-Powered-By` 保持关闭；
- Web 与 Worker 容器以非 root 用户运行；编排环境建议启用只读根文件系统、丢弃 Linux capabilities、`no-new-privileges`，仅按平台要求挂载可写临时目录；
- 新表已评估 RLS，新接口完成对象级权限与输入校验；
- 平台余额、发布履约、账号与权限操作可在审计日志追溯；
- 定期验证备份恢复、密钥可用性、Session 撤销和 RLS 矩阵。
