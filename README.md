# AnswerBit GEO SaaS

多租户 GEO 管理平台工程骨架。

## 文档

系统架构、领域规则、接口契约、运行手册与 ADR 从 [`docs/index.md`](./docs/index.md) 进入。开发任何跨模块功能前，按目录中的“读取时机”读取对应文档。

持续集成在 push、pull request 和手工触发时执行 `pnpm verify`、两次全新数据库发布以及三个 Docker 目标构建；Actions 固定不可变提交，依赖与基础镜像由 Dependabot 周期更新。

## 启动

```bash
cp .env.example .env
pnpm install
pnpm db:up
# 校验发布配置并依次执行迁移、版本记录、幂等种子和 RLS 隔离检查
pnpm db:release
pnpm dev
```

`pnpm dev` 会并行启动 Web 与 Worker，使腾讯企业目录同步、异步任务恢复和通知评估在本地默认运行；只需要 Web 时使用 `pnpm dev:web`。

- Web: http://localhost:3000
- liveness: `/api/health/live`
- readiness: `/api/health/ready`
- 首次启动: http://localhost:3000/setup

如果本机 `5432` 或 `6379` 已占用，可通过 `POSTGRES_PORT`、`REDIS_PORT` 修改映射端口，并同步修改 `.env` 中的连接 URL。
根目录脚本会自动读取根目录 `.env`。Web 与 Worker 使用 `DATABASE_URL`；完整数据库发布使用单独的 `MIGRATION_DATABASE_URL`，本地环境允许两者指向同一开发数据库，生产环境必须注入独立迁移身份。

Readiness 会同时校验服务端运行配置、数据库连接、Redis 连接、当前应用要求的最低迁移版本和基础种子版本；任一发布步骤未完成时都不会接收生产流量。数据库/Redis URL、32 字节 Base64 加密主密钥、认证密钥或可信 Origin 无效时同样拒绝接流。Redis 用于 Better Auth 原子分布式限流；Session 与当前账号资料直接读取 PostgreSQL，使账号停用和会话撤销即时生效。Worker 使用同一配置包在启动时快速失败，避免带错误配置持续运行。

业务数据库连接池和 pg-boss 连接池分别通过 `DB_POOL_MAX` 与 `JOB_DB_POOL_MAX` 限流，并配置建连/查询超时、空闲回收和连接最长生命周期；生产副本扩容前应按部署手册核算 PostgreSQL 总连接预算。

系统只使用账号密码登录，不开放用户自行注册。全新数据库完成迁移和种子后访问 `/setup`，设置第一个平台管理员的名称、账号和密码；初始化使用数据库事务锁保证只能成功一次。此后 `/setup` 自动关闭，平台管理员在 `/admin` 统一创建平台管理员、企业管理员和普通成员账号，再由企业成员管理按账号绑定企业及品牌权限。

密码至少 12 位并同时包含字母和数字，只以 Better Auth 的 scrypt 哈希写入 `accounts` 表。登录接口按账号限流，停用账号时会立即撤销现有 Session。旧环境中的无密码账户不会被视为已初始化；迁移后需要先完成一次 `/setup`。

生成本地加密主密钥：

```bash
openssl rand -base64 32
```

登录后，平台管理员必须先在 `/admin` 的“腾讯接入”配置一组固定 Tencent TeamID 和统一 AnswerBit API Key。配置请求一次完成腾讯验证、已有品牌导入和企业投影；接入成功前，企业、用户、计费及业务模块保持锁定。接入完成后，平台企业的新增、编辑和删除分别直接调用腾讯 `/geo/brand/create`、`/geo/brand/update` 和 `/geo/brand/delete`，腾讯成功后才创建、更新或关闭本地租户投影。每个腾讯 BrandID 会自动生成一一对应的平台企业租户投影，不再单独创建本地企业。系统直接调用已接入 OpenAPI，Key 权限以腾讯官方控制台为准。品牌、竞品、问题分类、监控问题和文章的业务写入均先调用腾讯接口，腾讯成功后才更新本地映射。企业管理员在 `/dashboard/settings/answerbit` 只读查看本企业品牌接入状态，不接触完整密钥，也不能解绑固定 TeamID。

总览页已接入 AnswerBit 动态平台、核心指标、提及率趋势、竞品排行与竞品增删改查；所有查询按企业和品牌权限隔离，内部腾讯范围由系统自动解析。

- `/dashboard/monitoring`：问题分类、单条/批量问题、启停、改写、移动和删除。
- `/dashboard/answers`：回答筛选、评分详情、大模型原文、引用域名与文章证据。
- `/dashboard/content`：通过“AI 生成 / 文档库 / 效果追踪”管理 AnswerBit 模板、异步文章任务、本地文档版本与公开文章追踪。
- `/dashboard/metering`：AnswerBit 上游订阅、周期配额、积分趋势、品牌排行与计量流水。
- `/dashboard/balances`：查询企业和品牌余额；有划拨权限的企业管理员或代理商可把企业余额划分到品牌。
- `/dashboard/publication/channels`、`/dashboard/publication/new`、`/dashboard/publication/orders`：分别选择媒体渠道、提交发布单和跟踪履约；旧 `/dashboard/billing` 仅作兼容跳转。
- `/dashboard/notifications`：企业级积分、连接与核心指标阈值规则，以及按用户隔离的站内已读状态。
- `/admin`：全局平台管理端，以固定 TeamID/统一 Key 接入为强制第一步，接入后开放腾讯企业直连增删改、自动目录同步、腾讯计量与官方积分扩容、用户类型切换及代理商有效期、企业成员权限、企业余额人工入账、业务功能积分单价、发布渠道价格、发布履约、Worker 与周期任务健康、AnswerBit 调用健康和操作审计。

平台没有在线充值、收款或第三方支付入口。所有余额由平台管理员人工划拨到企业，再由企业管理员或代理商划分到品牌：`answerbit_points` 以整数积分计量腾讯能力调用，`publication_cny` 以人民币分计量媒体发布。

回答与引用页支持把企业、品牌、日期、平台和关键词保存为个人视图；企业管理员和品牌管理员可以创建回答、引用域名及引用文章 CSV 导出。导出由 Worker 再次复核品牌权限，使用平台额度，最多输出 10,000 行，文件 24 小时后自动清除。

文章生成由独立 Worker 执行；根目录 `pnpm dev` 已包含开发 Worker，也可单独运行：

```bash
pnpm worker
```

Worker 每 5 分钟执行资源周期维护、异步任务恢复和聚合发布履约同步，每日执行腾讯企业目录同步，并每 15 分钟评估站内通知规则。运行心跳、五项周期任务状态以及文章/报告队列健康会展示在平台“运行与审计”。等待超过 10 分钟或执行超过 15 分钟的异步任务会进入恢复检查；执行租约阻止旧 Worker 覆盖新结果，已经扣费但没有腾讯 ArticleID 的不确定文章任务会终止并幂等退款。AnswerBit 接口调用本身不计费；完整业务功能按管理员配置的功能积分单价一次性扣减，功能失败自动返还，异步文章任务同样按品牌积分账户结算。任务、余额流水和通知均以幂等键去重。

生产部署可从根目录多阶段 Dockerfile 构建非 root 的独立运行镜像和一次性数据库发布镜像：

单机自托管推荐直接运行交互式安装引导，它会选择内置或外部 PostgreSQL/Redis、生成 `.env.production`、构建 Compose 镜像、发布数据库并启动服务：

```bash
pnpm install:docker
```

完整说明见 [`docs/operations/docker_installation.md`](./docs/operations/docker_installation.md)。手工构建仍可使用：

```bash
docker build --target release -t answerbit-geo-release:VERSION .
docker build --target web -t answerbit-geo-web:VERSION .
docker build --target worker -t answerbit-geo-worker:VERSION .
```

`release` 镜像仅携带数据库发布所需依赖，读取 `MIGRATION_DATABASE_URL` 后依次执行配置校验、迁移、记录 schema 版本、幂等种子和 RLS 检查，任一步失败即以非零状态退出；只读根文件系统下需要为 `/tmp` 挂载临时可写目录。发布任务成功后再启动 Web 与 Worker。Web 镜像运行 Next.js standalone 并内置 readiness 健康检查；Worker 镜像运行构建后的单文件 bundle。真实数据库、认证和加密密钥只在容器运行时注入。

平台管理员可在媒体发布页面验证并加密保存媒体发布 API Key，查看上游余额与算力；发布单提交时按渠道人民币价格快照从品牌发布余额扣减，聚合订单自动同步、人工渠道由管理员履约，失败和取消会自动返还原品牌余额。

数据库以 `packages/db/drizzle/v1.sql` 初始化 44 张表的完整基线，`v2.sql` 增加网页保存的媒体发布平台凭证，`v3.sql` 增加客户价格等级、采购成本、上游状态与渠道固定售价，`v4.sql` 增加品牌文档库、不可变版本、文件夹及发布来源关联，`v5.sql` 增加 AnswerBit 只读分析缓存；`system_release_state` 当前记录 schema `v5`、seed `v2`。v1 基线包含当时的枚举、约束、索引、8 个触发器函数、RLS 与授权，不再重放历史增删过程。基线会创建无登录权限的 `geo_tenant_app` 与 `geo_platform_app` 角色。新增 Repository 事务应分别使用 `withTenantDbContext` 或 `withPlatformDbContext`，上下文通过事务级 `set_config` 注入且在提交后自动清除；迁移账号仅用于迁移与本地开发，不应作为生产 Web 直连账号。旧环境升级前必须完整执行原 0000—0044 迁移链，并保留 `drizzle.__drizzle_migrations`。

## 后端分层

新增业务按 `HTTP Route → Application Service → Repository → PostgreSQL` 单向依赖。账号体系放在 `apps/web/src/server/modules/identity`：Route 只解析协议与返回状态码，Service 负责初始化、密码哈希和业务错误，Repository 只负责事务、锁和持久化。共享请求契约统一放在 `packages/contracts`，数据库定义和迁移统一放在 `packages/db`，页面不会直接访问数据库。
