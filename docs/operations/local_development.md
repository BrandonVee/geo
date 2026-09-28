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
| `FROG_PUBLICATION_BASE_URL`    | 小青蛙聚合发布兼容回退地址；优先使用管理网页保存的配置  |
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

全新数据库先由 `packages/db/drizzle/v1.sql` 建立基线，再依次执行 `v2.sql` 小青蛙平台凭证、`v3.sql` 分级定价结构、`v4.sql` 本地文档库结构及历史生成内容回填、`v5.sql` AnswerBit 读取缓存、`v6.sql` 积分加价规则与 `v7.sql` 异步文章价格快照，记录 schema `v7`、执行 seed `v2` 的幂等种子并完成 RLS 检查。升级到 v6 时，未修改的旧等级规则转为当前发布加价率；已由管理员修改的规则保留原实际扣费，旧折扣显示为负加价率。v7 为新文章任务保存提交时的价格快照，旧任务仍按执行时规则计价。后续 schema 变化继续通过 `pnpm db:generate` 生成增量迁移并递增 `vN`，不直接修改已发布迁移。

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

`pnpm dev` 默认并行启动 Web 与 Worker，不需要另开终端。Worker 依赖与 Web 相同的 `DATABASE_URL` 和 `APP_ENCRYPTION_KEY`，负责文章生成、报告导出、通知评估、腾讯目录同步、聚合发布履约同步、异步任务恢复和资源维护。启动完成后每 30 秒写入一次平台运行心跳；计费维护、异步任务恢复、通知评估、目录同步与聚合发布同步还会更新各自最近执行状态、耗时和错误码。`/admin?section=operations` 应显示 1 个在线 Worker、5 项周期任务（小青蛙 Key 未配置时发布同步跳过上游工作），且文章/报告过期任务均为 0。

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

文档库的真实 PostgreSQL 回归在完成 `pnpm db:release` 后运行 `CONTENT_DOCUMENT_DB_TESTS=1 node scripts/run-with-env.mjs pnpm --filter @geo/web exec vitest run src/server/repositories/content-documents.integration.test.ts`。测试使用新建 UUID 范围并清理数据，覆盖文档与首版创建、并发版本递增、历史恢复及文件夹品牌隔离；默认测试跳过此用例。

成员额度的真实 PostgreSQL 并发回归在完成 `pnpm db:release` 后运行 `MEMBER_CAPACITY_DB_TESTS=1 node scripts/run-with-env.mjs pnpm --filter @geo/web exec vitest run src/server/repositories/members.integration.test.ts`。测试使用新建 UUID 范围并清理数据，覆盖并发新增、并发恢复与新增共同争用最后一个名额；默认测试跳过此用例。
