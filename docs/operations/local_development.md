# 本地开发

本文给出开发环境依赖、配置、数据库初始化、首次管理员创建、常用命令和最小验证流程，适用于从空环境启动仓库。

## 前置依赖

- Node.js：满足当前 pnpm 工作区和 Next.js 版本要求；
- pnpm `10.33.0`；
- Docker 与 Docker Compose；
- 可用端口：Web 默认 `3000`、PostgreSQL 默认 `5432`、Redis 默认 `6379`。

## 环境变量

先复制样例：

```bash
cp .env.example .env
```

| 变量                           | 用途                                                    |
| ------------------------------ | ------------------------------------------------------- |
| `POSTGRES_PORT`                | Docker 暴露的 PostgreSQL 端口，默认 `5432`              |
| `DATABASE_URL`                 | Web 与 Worker 使用的数据库连接串                        |
| `REDIS_URL`                    | Web 登录会话缓存与分布式限流使用的 Redis 连接串         |
| `REDIS_CONNECT_TIMEOUT_MS`     | Redis 建连超时，默认 5 秒                               |
| `MIGRATION_DATABASE_URL`       | 数据库发布任务使用的迁移连接串                          |
| `DB_APPLICATION_NAME`          | PostgreSQL 中显示的应用连接标识                         |
| `DB_POOL_MAX`                  | 每个进程的业务数据库连接池上限，默认 10                 |
| `JOB_DB_POOL_MAX`              | 每个进程的 pg-boss 连接池上限，默认 5                   |
| `DB_POOL_IDLE_TIMEOUT_MS`      | 空闲业务连接回收时间，默认 30 秒                        |
| `DB_POOL_MAX_LIFETIME_SECONDS` | 单条业务连接最长生命周期，默认 300 秒                   |
| `DB_CONNECT_TIMEOUT_MS`        | PostgreSQL 建连超时，默认 5 秒                          |
| `DB_QUERY_TIMEOUT_MS`          | 单条业务查询客户端超时，默认 30 秒                      |
| `APP_URL`                      | 浏览器访问 Web 的公共地址                               |
| `APP_VERSION`                  | 发布版本标识，写入 Worker 运行心跳                      |
| `APP_ENCRYPTION_KEY`           | AnswerBit API Key 加密主密钥，Base64 解码后恰好 32 字节 |
| `BETTER_AUTH_SECRET`           | Better Auth 签名密钥，至少 32 字符                      |
| `BETTER_AUTH_URL`              | Better Auth 的服务端基础地址                            |
| `BETTER_AUTH_TRUSTED_ORIGINS`  | 允许的浏览器 Origin，逗号分隔                           |
| `ANSWERBIT_BASE_URL`           | 腾讯 AnswerBit API 基础地址                             |
| `FROG_PUBLICATION_BASE_URL`    | 媒体发布服务兼容回退地址；优先使用管理网页保存的配置    |
| `FROG_PUBLICATION_API_KEY`     | 兼容回退 Key；可留空并在发布履约页验证、加密保存        |

生成本地加密密钥可使用：

```bash
openssl rand -base64 32
```

`APP_URL`、`BETTER_AUTH_URL` 和实际浏览器 Origin 应一致，并且只能填写不含路径、查询参数、凭证或片段的完整 HTTP(S) Origin；通过局域网 IP 访问时把该 Origin 加入 trusted origins。

Web readiness 与 Worker 启动都会使用 `packages/config` 校验环境变量。`APP_ENCRYPTION_KEY` 必须是 `openssl rand -base64 32` 生成的规范 Base64 值，解码后恰好 32 字节；尾随字符、空白和省略填充均会被拒绝。`DATABASE_URL` 必须使用 `postgres:` 或 `postgresql:` 协议，Web 的 `REDIS_URL` 必须使用 `redis:` 或 `rediss:` 协议，数据库连接池容量、建连/查询超时和连接生命周期必须位于约束范围，`APP_URL`、`BETTER_AUTH_URL` 与 trusted origins 只能填写 HTTP(S) Origin；配置错误时 readiness 返回 `503 CONFIGURATION_INVALID`，Worker 直接以非零状态退出。`MIGRATION_DATABASE_URL` 仅由 `db:release` 使用，生产环境不得复用 Web/Worker 运行身份。

## 首次启动

```bash
pnpm install
pnpm db:up
pnpm db:release
pnpm dev
```

全新数据库先由 `packages/db/drizzle/v1.sql` 建立基线，再依次执行 `v2.sql` 媒体发布平台凭证、`v3.sql` 分级定价结构、`v4.sql` 本地文档库结构及历史生成内容回填、`v5.sql` AnswerBit 读取缓存、`v6.sql` 积分加价规则与 `v7.sql` 异步文章价格快照，随后执行 `v8.sql` 企业服务与积分到期日及 `v9.sql` 文档创建幂等键和原请求指纹，再执行 `v10.sql` 效果追踪幂等提交与结果状态、`v11.sql` 企业历史流水操作者受限显示查询，记录 schema `v11`、执行 seed `v2` 的幂等种子并完成 RLS 检查。升级到 v6 时，未修改的旧等级规则转为当前发布加价率；已由管理员修改的规则保留原实际扣费，旧折扣显示为负加价率。v7 为新文章任务保存提交时的价格快照，旧任务仍按执行时规则计价。后续 schema 变化继续通过 `pnpm db:generate` 生成增量迁移并递增 `vN`，不直接修改已发布迁移。Drizzle 快照使用四位序号文件名（如 `0008_snapshot.json`）并以 `prevId` 串联，避免混用版本名导致生成器误读旧快照或产生分叉。

访问：

- Web：`http://localhost:3000`
- 初始化：`http://localhost:3000/setup`
- 存活：`http://localhost:3000/api/health/live`
- 就绪：`http://localhost:3000/api/health/ready`

本机 `5432` 或 `6379` 被占用时：

```bash
POSTGRES_PORT=55432 docker compose up -d postgres
# Redis 示例：REDIS_PORT=56379 docker compose up -d redis
```

随后把 `.env` 中对应的 `DATABASE_URL` 或 `REDIS_URL` 端口同步修改。

## 创建首个管理员

迁移与种子完成后打开 `/setup`，填写管理员名称、用户名和两次密码。密码至少 12 位并同时包含字母和数字。成功后浏览器跳到 `/sign-in?initialized=1`；使用刚创建的用户名和密码登录，再从 `/admin` 创建后续账号。

初始化只允许一次。若提示 `SYSTEM_NOT_READY`，先执行 `pnpm db:seed`；若提示 `SYSTEM_ALREADY_INITIALIZED`，直接进入登录页。

## Worker

`pnpm dev` 默认并行启动 Web 与 Worker，不需要另开终端。Worker 依赖与 Web 相同的 `DATABASE_URL` 和 `APP_ENCRYPTION_KEY`，负责文章生成、报告导出、通知评估、腾讯目录同步、聚合发布履约同步、异步任务恢复和资源维护。启动完成后每 30 秒写入一次平台运行心跳；计费维护、异步任务恢复、通知评估、目录同步与聚合发布同步还会更新各自最近执行状态、耗时和错误码。`/admin?section=operations` 应显示 1 个在线 Worker、5 项周期任务（媒体发布 Key 未配置时发布同步跳过上游工作），且文章/报告过期任务均为 0。

`pnpm db:up` 会同时启动本地 PostgreSQL 和 Redis。Redis 用于 Better Auth 会话缓存与分布式登录限流；持久 Session 仍写入 PostgreSQL。

只调试同步 Web 时可运行 `pnpm dev:web`；需要单独重启 Worker 时可另开终端运行 `pnpm worker`。单独运行 Web 不会执行腾讯目录自动同步或其他周期任务。

`pnpm --filter @geo/worker build` 会在类型检查后生成自包含的 `apps/worker/dist/index.mjs` 和 source map；可用 `pnpm worker:prod` 读取根目录 `.env` 并在本机验证生产 Worker 入口。生产数据库发布、Web 与 Worker 镜像分别通过根目录 Dockerfile 的 `release`、`web`、`worker` 目标构建。

## 常用命令

| 命令                  | 作用                              |
| --------------------- | --------------------------------- |
| `pnpm dev`            | 并行启动 Web 与 Worker            |
| `pnpm dev:web`        | 只启动 Web 开发服务器             |
| `pnpm worker`         | 启动异步 Worker                   |
| `pnpm worker:prod`    | 启动已构建的生产 Worker bundle    |
| `pnpm build`          | 构建全部工作区                    |
| `pnpm lint`           | 运行全部 lint/类型检查            |
| `pnpm test`           | 运行全部测试                      |
| `pnpm verify`         | 执行与 CI Quality gate 相同的检查 |
| `pnpm format:check`   | 检查后端和共享包格式              |
| `pnpm db:generate`    | 根据 schema 生成迁移              |
| `pnpm db:migrate`     | 执行数据库迁移                    |
| `pnpm db:release`     | 执行迁移、版本记录、种子和 RLS    |
| `pnpm db:seed`        | 幂等写入角色、权限和默认资源配置  |
| `pnpm db:grant-admin` | 按脚本约定授予平台管理员          |
| `pnpm db:rls-check`   | 验证平台/租户角色的 RLS 矩阵      |
| `pnpm db:up`          | 启动本地 PostgreSQL 与 Redis      |
| `pnpm db:down`        | 停止本地 Docker 服务              |
| `pnpm install:docker` | 运行生产 Docker Compose 安装引导  |

## 提交前验证

```bash
pnpm verify
```

CI 还会在全新 PostgreSQL 18 中连续执行两次 `pnpm db:release`，并构建三个 Docker 目标验证非 root 运行。涉及 schema 或 RLS 时，本地也应在已迁移的数据库至少执行一次 `pnpm db:release`。从旧迁移链升级的环境必须先确认旧 `0044_lively_shard` 已执行完成；不要删除或手工改写 `drizzle.__drizzle_migrations`。涉及登录时验证 `/setup` 单次初始化、登录成功、停用用户拒绝登录；涉及余额和发布时验证重复幂等键不会重复扣款或返还。

发布账本的真实 PostgreSQL 回归需先完成 `pnpm db:release`，再运行 `PUBLICATION_DB_TESTS=1 node scripts/run-with-env.mjs pnpm --filter @geo/db test`。测试仅使用新建 UUID 隔离数据并在结束时清理，覆盖并发幂等扣款、退款、零元订单与上游迟到状态；默认单元测试不连接数据库执行这些用例。

文档库的真实 PostgreSQL 回归在完成 `pnpm db:release` 后运行 `CONTENT_DOCUMENT_DB_TESTS=1 node scripts/run-with-env.mjs pnpm --filter @geo/web exec vitest run src/server/repositories/content-documents.integration.test.ts`。测试使用新建 UUID 范围并清理数据，覆盖文档并发创建重放、原操作者与内容校验、编辑后创建重放、过期并发保存拒绝、历史恢复与归档版本校验及文件夹品牌隔离；默认测试跳过此用例。

成员额度的真实 PostgreSQL 并发回归在完成 `pnpm db:release` 后运行 `MEMBER_CAPACITY_DB_TESTS=1 node scripts/run-with-env.mjs pnpm --filter @geo/web exec vitest run src/server/repositories/members.integration.test.ts`。测试使用新建 UUID 范围并清理数据，覆盖并发新增、并发恢复与新增共同争用最后一个名额；默认测试跳过此用例。

企业有效期与手动扣减的真实 PostgreSQL 回归：先执行 `pnpm db:release`，再运行 `ENTERPRISE_BALANCE_DB_TESTS=1 node scripts/run-with-env.mjs pnpm --filter @geo/db exec vitest run src/enterprise-balances.integration.test.ts`。用例仅创建独立 UUID 数据并清理，覆盖重复扣减、余额不足、到期阻止消费、续期恢复和冻结后退款。

运营页面回归在 Redis 可用且 `MIGRATION_DATABASE_URL` 账号可创建、删除数据库时，安装 Playwright Chromium 后运行 `node scripts/test-operator-workflows.mjs`。脚本创建独立 `geo_workflow_qa_*` 数据库并完成两次迁移、种子和 RLS 检查及文档、积分统计、报告、文章提交 PostgreSQL / pg-boss 回归，以及效果追踪事务、发布订单分页与成员额度/最后管理员、跨企业账号停用与交接、企业续期与恢复并发回归及企业目录分页查询、平台资产调整与流水快照回归，写入测试接入配置，再构建与启动生产 Web，以临时端口运行浏览器回归，结束后关闭服务并删除测试库。腾讯和发布地址指向测试服务，业务调用在浏览器中模拟；无需真实上游 Key 或已运行的开发服务。用例覆盖草稿恢复、企业切换、文章生成响应丢失后刷新确认及后续输入保留、普通与参考生成分别恢复、追踪语言独立和待核对提交恢复、迟到追踪详情隔离、发布订单搜索/状态/日期筛选与刷新恢复、后台企业/人工队列分页、人工交付失败保留表单与响应丢失核对、失败返还不重复及写入后列表读取失败重试、取消后页码回退、订单读取失败重试、已发布订单带入追踪及已有草稿/待确认提交保护、企业划拨精度校验、失败输入保留、响应丢失后原品牌恢复与只读核对、同键重试、范围切换及迟到余额隔离、积分到期与人民币独立可用、企业/品牌积分查看、超过百家企业的资产搜索与分页、企业资金池和品牌余额分列、流水范围与用户远程搜索、资产目录及流水独立错误重试、角色隔离、明暗主题及多尺寸无障碍检查、成员开户/权限/停用失败恢复、响应丢失只读核对、最后管理员保护、全局账号停用逐家交接和只读核对、平台企业详情和用户档案的授权/启停/移除失败恢复、权限保存后刷新失败重试及抽屉迟到响应隔离、企业目录 BrandID 搜索、服务状态筛选、URL 恢复、冻结末页回退、迟到读取隔离与错误重试、企业冻结确认、历史空期限保留、服务与积分独立续期、到期续期恢复、多人续期冲突和响应丢失只读核对，个人视图管理、报告重试、文档暂存恢复、成功响应丢失后的创建重放与多人编辑冲突合并；审计记录保持不可变，由测试库整体删除完成清理。测试文件要求一次性数据库标识，禁止直接对日常开发数据库执行。脚本支持透传 `--grep` 等 Playwright 参数。多用例登录共享同一客户端 IP，达到真实登录限流时按服务端 `Retry-After` 等待后重试，不关闭限流。

发布流程浏览器回归覆盖投稿与申诉权限变化后的输入保留、无权限请求拒绝、原页重新检查权限后明确提交，以及申诉提交锁、明确失败保留说明与再次提交；订单分页、取消末页回退和读取失败恢复使用同一回归脚本。

发布订单分页回归由同一一次性数据库脚本以 `ORDER_HISTORY_DB_TESTS=1` 运行 `src/publication-order-page.integration.test.ts`。使用真实租户/平台角色与只读快照，覆盖相同时间的稳定分页、企业/品牌隔离与平台跨企业查询、企业/品牌/标题/媒体/编号检索、来源与状态过滤、文字通配符转义、北京时间日期边界及超界页码回退；不投稿、不扣费、不调用真实上游，只允许一次性数据库。

报告原子提交回归由上述一次性数据库脚本运行 `src/server/services/report-exports.integration.test.ts`，保留真实 Repository、额度事务、审计和 pg-boss，只替换业务授权边界。覆盖提交前不可见、同键并发、最后名额竞争、入队后异常、审计失败全回滚、额度补配重试、旧半成品恢复、自动补投失败回滚与并发去重、Worker 预占修复及确认/释放互斥；不调用上游、不允许对日常开发库直接执行，审计和额度历史由删除整个测试库清理。

文章生成提交回归由同一脚本以 `ARTICLE_SUBMISSION_DB_TESTS=1` 运行 `src/server/services/articles.integration.test.ts`。保留真实价格读取、加密、Repository、审计和 pg-boss，仅替换授权、腾讯范围加载和模板查询；覆盖提交前不可见、并发同键、入队或审计失败回滚、旧任务原价恢复、自动补投去重、结果查询与执行租约的原子调度、终态不重新执行及报价/模板校验。测试不启动生成 Worker，不调用腾讯，不实际扣积分，历史随一次性数据库清理。

效果追踪提交回归由同一一次性数据库脚本以 `ARTICLE_TRACKING_DB_TESTS=1` 运行 `src/server/services/article-tracking.integration.test.ts`。保留真实预扣/返还、加密请求、Repository、审计与 RLS，替换业务授权和腾讯接口；覆盖并发提交、成功重放、报价/余额拒绝、审计回滚、已保存 ArticleID 的收尾恢复、上游明确失败/超时、后台中断返还与迟到成功、文章归属校验。只允许一次性数据库，不连接真实腾讯，不在日常库执行。

Worker 等待任务的权限复核回归在已迁移数据库执行 `WORKER_ACCESS_DB_TESTS=1 node scripts/run-with-env.mjs pnpm --filter @geo/worker exec vitest run src/job-access.integration.test.ts`。只创建独立 UUID 数据并清理，不创建任务或调用上游，覆盖成员／账号停用、角色降级、功能模块关闭、代理商到期和品牌归属。

企业生命周期回归由同一一次性数据库脚本以 `ENTERPRISE_LIFECYCLE_DB_TESTS=1` 运行 `src/server/services/enterprise-lifecycle.integration.test.ts`，保留真实企业行锁与审计事务，仅替换平台权限边界；覆盖并发续期旧日期拒绝、服务与积分独立修改、到期恢复拒绝与原子续期恢复、单独续期保留冻结、并发冻结使旧表单冲突、关闭企业拒绝和审计失败回滚。历史记录随一次性数据库删除，不对日常开发库执行。

企业目录查询由同一一次性数据库脚本以 `ORGANIZATION_DIRECTORY_DB_TESTS=1` 运行 `src/server/repositories/organization-directory.integration.test.ts`，使用真实平台角色与只读快照，覆盖企业/品牌名称、BrandID、UUID 和内部标识检索、文字通配符转义、相同接入时间的稳定分页、服务与积分到期独立状态、手动冻结优先、旧 status 筛选兼容、关闭/未映射企业隐藏、成员计数以及冻结末页后的页码回退；资产目录另覆盖资金池与当前品牌余额隔离、缺少账户、超过百家查询和末页回退。测试独立创建并清理 UUID 数据，不调用腾讯，不对日常库执行。

平台资产调整由同一一次性数据库脚本以 `BALANCE_ADJUSTMENT_DB_TESTS=1` 运行 `src/server/services/balance-adjustments.integration.test.ts`，保留真实余额事务、流水、审计和结果核对查询，仅替换平台权限边界；覆盖并发重放、同键内容冲突、审计失败整体回滚、缺少账户的回滚与重试、余额不足，以及冻结到期后的纠错。浏览器覆盖原弹窗错误与输入保留、金额精度校验、提交结果核对、刷新恢复原请求及同键重试；不调用真实上游，审计随测试库整体删除。

平台资产流水由同一一次性数据库脚本以 `ADMIN_BALANCE_HISTORY_DB_TESTS=1` 运行 `packages/db/src/admin-balance-history.integration.test.ts`，验证真实平台角色下相同时间稳定分页、来源与目标品牌、筛选条件交集、关闭企业历史、末页回退及并发写入时总数与明细快照一致；要求 `WORKFLOW_DISPOSABLE_DB=1` 且数据库名为 `geo_workflow_qa_*`，不对日常库执行。

企业品牌划拨由同一一次性数据库脚本以 `BALANCE_ALLOCATION_DB_TESTS=1` 运行 `src/server/services/balance-allocations.integration.test.ts`，保留真实余额事务、审计和租户核对查询，只替换企业授权边界；覆盖两类资产并发重放、同键内容冲突、审计失败整体回滚、原操作者及品牌核对隔离、核对等待事务、代理商跨企业额度竞争与到期限制。测试要求一次性库；不可变审计由脚本删除整个测试库清理。

企业资产流水由同一一次性数据库脚本以 `TENANT_BALANCE_HISTORY_DB_TESTS=1` 运行 `packages/db/src/tenant-balance-history.integration.test.ts`，使用真实租户角色，覆盖超过 100 条历史的稳定分页、来源/目标账户、操作者与资产/类型交集、北京时间边界、历史停用成员搜索、文字通配符转义和并发读取快照。浏览器验证完整历史查找、远程操作者筛选、URL 刷新恢复、流水独立错误重试、企业和筛选条件的迟到响应隔离及查账时保留待划拨输入；品牌角色不能读取企业整体余额和流水。

通知工作流由一次性数据库脚本以 `NOTIFICATION_WORKFLOW_DB_TESTS=1` 运行 `src/server/repositories/notifications.integration.test.ts`，覆盖超过50条的完整历史、稳定分页、北京时间筛选、品牌隔离、私有已读与跨页批量已读，以及并发规则创建去重、配置比较冲突、Worker健康更新不冲突、审计回滚与重放。浏览器同时覆盖读取独立重试、历史末页、跨页批量已读、品牌权限、失败输入保留、并发阈值冲突与响应丢失后刷新核对，以及明暗主题多尺寸无障碍。数据库历史随测试库整体删除清理，不对日常库执行。

报告历史由一次性数据库脚本以 `REPORT_HISTORY_DB_TESTS=1` 执行 `src/server/repositories/report-history.integration.test.ts`，使用真实租户上下文和只读快照验证超过百条的稳定分页、企业/绑定/品牌隔离、同品牌历史任务、即时过期状态、北京时间提交日期和文字通配符检索；元数据不返回CSV正文。浏览器覆盖筛选/页码刷新恢复、独立读取失败重试、迟到响应隔离及新提交定位；历史随一次性数据库删除清理。

监测问题库浏览器回归使用同一一次性数据库脚本，模拟腾讯分类、问题和模型的独立读取与目录写入，覆盖批量去空行及去重、数量与长度校验、弹窗失败保留输入、写入时锁定、响应丢失刷新恢复与人工只读核对、切换范围的迟到写入隔离、返回仍在提交的原范围时继续锁定并在完成后刷新，以及筛选失败不显示旧结果、品牌降级后四类窗口禁止提交与原窗口恢复输入、服务到期禁止写入及续期后原窗口恢复；正常操作不增加确认步骤，结果不确定时不重放创建。

竞品与总览浏览器回归使用同一一次性数据库脚本，模拟腾讯目录及指标接口，验证品牌/模型/竞品独立失败与重试、名称/别名校验、保存失败保留输入、提交锁、响应丢失后恢复与只读核对、跨企业迟到写入隔离及超过100个竞品的分批对比，以及总览浏览器往返、加载期间清除旧品牌、迟到目录隔离和品牌权限刷新后新增/编辑/删除窗口禁止提交、输入保留及权限恢复后继续；共享目录读取与待核对暂存也由监测流程回归覆盖。

回答证据浏览器回归使用同一一次性数据库脚本，验证回答/域名/文章/模型独立加载与重试、引用完整分页、回答翻页不改动引用目录、查询变更立即隐藏旧结果，以及详情失败重试、关闭与切换后的迟到响应隔离；明暗主题和多尺寸包含回答表格与详情抽屉，并以北京时间凌晨验证当地日期的近七天范围。

共享范围浏览器回归验证企业/品牌切换后URL与刷新恢复、跨工作区导航携带范围、同范围目录重试保留输入、品牌授权撤销与角色降级，以及浏览器存储禁用时通过URL恢复选择；企业整体和当前品牌积分视图单独恢复，订单切换范围清除旧条件与发布来源。共享控件变更同时回归监测、回答、内容、通知、积分和资产划拨的范围切换与输入恢复。
