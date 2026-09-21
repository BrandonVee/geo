# Docker 安装引导

根目录 `scripts/install-docker.sh` 是自托管安装入口，配合 `docker-compose.production.yml` 完成配置采集、镜像构建、数据库发布、Web 与 Worker 启动。基础设施可以选择 Compose 内置 PostgreSQL 18 和 Redis 8，也可以填写外部托管服务连接串。

## 前置条件

- 64 位 Linux 服务器；
- Docker Engine 与 Docker Compose v2；
- `openssl` 和 `curl`；
- 对外域名已经解析到服务器；生产环境应在 Web 前配置 HTTPS 反向代理。

## 引导安装

```bash
pnpm install:docker
# 或
bash scripts/install-docker.sh
```

引导依次采集：

1. 公共访问 Origin、宿主机端口、版本号和 Compose 项目名；
2. 内置基础设施或外部 PostgreSQL/Redis；
3. 外部模式下的业务数据库 URL、迁移数据库 URL 和 Redis URL；
4. AnswerBit 地址，以及可选的小青蛙兼容回退地址与 Key；小青蛙推荐在启动后的“发布履约”网页中验证并保存；
5. 是否立即构建并启动。

脚本自动生成独立的 `APP_ENCRYPTION_KEY` 与 `BETTER_AUTH_SECRET`，把最终配置写入权限为 `600` 的 `.env.production`。该文件已被 Git 忽略，不得复制到镜像、日志或代码仓库。`APP_ENCRYPTION_KEY` 必须单独备份，更新版本时继续使用原值。

选择立即启动后，脚本会：

1. 校验 Compose 配置；
2. 构建 `release`、`web` 与 `worker` 三个目标；
3. 内置模式启动并等待 PostgreSQL 与 Redis 健康；
4. 一次性运行 release 服务，依次执行迁移、记录 schema 版本、种子和 RLS 检查；
5. 启动 Web 与 Worker；
6. 等待 `/api/health/ready` 同时确认配置、PostgreSQL、Redis 和数据库发布版本；
7. 输出 `/setup` 首位管理员初始化地址。

## 外部服务连接

外部 PostgreSQL 使用 `postgres://` 或 `postgresql://`；外部 Redis 使用 `redis://`，启用 TLS 时使用 `rediss://`。生产环境应分别提供业务连接和权限更高、短时使用的迁移连接。Redis 承载 Better Auth 分布式登录限流与会话缓存，PostgreSQL 继续保存持久 Session，因此 Redis 数据不作为账号恢复来源。

外部服务模式不会启动 Compose 中带 `bundled` profile 的 PostgreSQL 和 Redis。确保 Docker 容器能够访问填写的主机名；不要把容器内的 `localhost` 当作宿主机或数据库服务器。

## 日常命令

```bash
# 查看状态
docker compose --env-file .env.production -f docker-compose.production.yml ps

# 查看日志
docker compose --env-file .env.production -f docker-compose.production.yml logs -f web worker

# 停止应用，保留数据卷
docker compose --env-file .env.production -f docker-compose.production.yml down

# 同时删除内置数据库与 Redis 数据，仅限确定重装
docker compose --env-file .env.production -f docker-compose.production.yml down -v
```

## 更新版本

保留 `.env.production`，修改 `APP_VERSION` 后执行：

```bash
docker compose --env-file .env.production -f docker-compose.production.yml --profile tools build release web worker
docker compose --env-file .env.production -f docker-compose.production.yml --profile tools run --rm release
docker compose --env-file .env.production -f docker-compose.production.yml up -d web worker
```

更新前备份 PostgreSQL。Redis AOF 卷可用于减少会话缓存丢失，但恢复业务的权威数据仍是 PostgreSQL。
