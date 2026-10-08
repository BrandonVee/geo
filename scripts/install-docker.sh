#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.production.yml"
ENV_FILE="$ROOT_DIR/.env.production"

cd "$ROOT_DIR"
umask 077

say() { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
die() { printf '\n错误：%s\n' "$*" >&2; exit 1; }
prompt() {
  local variable="$1" label="$2" default_value="${3:-}" value
  if [[ -n "$default_value" ]]; then
    read -r -p "$label [$default_value]: " value
    printf -v "$variable" '%s' "${value:-$default_value}"
  else
    read -r -p "$label: " value
    [[ -n "$value" ]] || die "$label 不能为空"
    printf -v "$variable" '%s' "$value"
  fi
}
prompt_secret() {
  local variable="$1" label="$2" value
  read -r -s -p "$label: " value
  printf '\n'
  [[ -n "$value" ]] || die "$label 不能为空"
  printf -v "$variable" '%s' "$value"
}
confirm() {
  local label="$1" default_value="${2:-y}" value suffix="[Y/n]"
  [[ "$default_value" == "n" ]] && suffix="[y/N]"
  read -r -p "$label $suffix: " value
  value="${value:-$default_value}"
  [[ "$value" =~ ^[Yy]$ ]]
}
random_hex() { openssl rand -hex "$1"; }
random_base64() { openssl rand -base64 "$1" | tr -d '\n'; }
compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}
wait_healthy() {
  local service="$1" container status attempt
  container="$(compose --profile bundled ps -q "$service")"
  [[ -n "$container" ]] || die "$service 容器未启动"
  for attempt in $(seq 1 60); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")"
    [[ "$status" == "healthy" ]] && return 0
    [[ "$status" == "unhealthy" || "$status" == "exited" ]] && break
    sleep 2
  done
  compose --profile bundled logs --tail=100 "$service" >&2
  die "$service 未通过健康检查"
}

command -v docker >/dev/null 2>&1 || die "请先安装 Docker"
docker compose version >/dev/null 2>&1 || die "请安装 Docker Compose v2"
command -v openssl >/dev/null 2>&1 || die "请先安装 openssl"
docker info >/dev/null 2>&1 || die "Docker 服务未启动或当前用户无访问权限"

say "AnswerBit GEO 安装引导"
printf '该引导会生成 .env.production，构建 Web/Worker/数据库发布镜像，并连接 PostgreSQL 与 Redis。\n'

if [[ -f "$ENV_FILE" ]] && ! confirm "检测到已有 .env.production，是否重新生成" "n"; then
  say "使用现有配置"
else
  prompt APP_URL "对外访问地址（例如 https://geo.example.com）"
  [[ "$APP_URL" =~ ^https?://[^/]+(:[0-9]+)?/?$ ]] || die "对外访问地址必须是完整 Origin，不能包含路径"
  APP_URL="${APP_URL%/}"
  if [[ ! "$APP_URL" =~ ^https:// && ! "$APP_URL" =~ ^http://(localhost|127\.0\.0\.1)(:[0-9]+)?$ ]]; then
    die "生产地址必须使用 HTTPS；HTTP 仅允许 localhost 或 127.0.0.1"
  fi
  prompt WEB_PORT "宿主机 Web 端口" "3000"
  [[ "$WEB_PORT" =~ ^[0-9]+$ && "$WEB_PORT" -ge 1 && "$WEB_PORT" -le 65535 ]] || die "Web 端口必须是 1-65535"
  prompt APP_VERSION "版本标识" "$(date +%Y%m%d-%H%M%S)"
  [[ "$APP_VERSION" =~ ^[A-Za-z0-9_.-]+$ ]] || die "版本标识只能包含字母、数字、点、下划线和短横线"
  prompt COMPOSE_PROJECT_NAME "Compose 项目名" "answerbit-geo"
  [[ "$COMPOSE_PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die "Compose 项目名只能包含小写字母、数字、下划线和短横线"

  read -r -p "基础设施模式：1) Compose 内置 PostgreSQL + Redis  2) 外部服务 [1]: " INFRA_MODE
  INFRA_MODE="${INFRA_MODE:-1}"
  [[ "$INFRA_MODE" == "1" || "$INFRA_MODE" == "2" ]] || die "请选择 1 或 2"

  POSTGRES_DB=geo
  POSTGRES_USER=geo
  POSTGRES_PASSWORD="$(random_hex 24)"
  REDIS_PASSWORD="$(random_hex 24)"
  COMPOSE_PROFILES=""
  if [[ "$INFRA_MODE" == "1" ]]; then
    COMPOSE_PROFILES=bundled
    DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}"
    MIGRATION_DATABASE_URL="$DATABASE_URL"
    REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379/0"
  else
    prompt_secret DATABASE_URL "PostgreSQL 业务连接 URL"
    read -r -s -p "PostgreSQL 迁移连接 URL（回车复用业务连接）: " MIGRATION_DATABASE_URL
    printf '\n'
    MIGRATION_DATABASE_URL="${MIGRATION_DATABASE_URL:-$DATABASE_URL}"
    prompt_secret REDIS_URL "Redis 连接 URL（redis:// 或 rediss://）"
  fi

  [[ "$DATABASE_URL" =~ ^postgres(ql)?:// ]] || die "数据库 URL 必须使用 postgres:// 或 postgresql://"
  [[ "$MIGRATION_DATABASE_URL" =~ ^postgres(ql)?:// ]] || die "迁移 URL 必须使用 postgres:// 或 postgresql://"
  [[ "$REDIS_URL" =~ ^rediss?:// ]] || die "Redis URL 必须使用 redis:// 或 rediss://"

  APP_ENCRYPTION_KEY="$(random_base64 32)"
  BETTER_AUTH_SECRET="$(random_base64 48)"
  prompt ANSWERBIT_BASE_URL "AnswerBit API 地址" "https://answerbit.qq.com"
  prompt FROG_PUBLICATION_BASE_URL "媒体发布接口地址" "http://8.138.187.158:8082"
  read -r -s -p "媒体发布 API Key（兼容回退，可留空并在媒体发布页面保存）: " FROG_PUBLICATION_API_KEY
  printf '\n'

  cat >"$ENV_FILE" <<EOF
# 由 scripts/install-docker.sh 生成；权限应保持 600，禁止提交版本库。
COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME
COMPOSE_PROFILES=$COMPOSE_PROFILES
APP_VERSION=$APP_VERSION
IMAGE_PREFIX=answerbit-geo
WEB_BIND_ADDRESS=127.0.0.1
WEB_PORT=$WEB_PORT

POSTGRES_DB=$POSTGRES_DB
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
REDIS_PASSWORD=$REDIS_PASSWORD

DATABASE_URL=$DATABASE_URL
MIGRATION_DATABASE_URL=$MIGRATION_DATABASE_URL
REDIS_URL=$REDIS_URL
REDIS_CONNECT_TIMEOUT_MS=5000

DB_POOL_MAX=10
JOB_DB_POOL_MAX=5
DB_POOL_IDLE_TIMEOUT_MS=30000
DB_CONNECT_TIMEOUT_MS=5000
DB_QUERY_TIMEOUT_MS=30000
DB_POOL_MAX_LIFETIME_SECONDS=300

APP_URL=$APP_URL
APP_ENCRYPTION_KEY=$APP_ENCRYPTION_KEY
BETTER_AUTH_URL=$APP_URL
BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET
BETTER_AUTH_TRUSTED_ORIGINS=$APP_URL

ANSWERBIT_BASE_URL=$ANSWERBIT_BASE_URL
FROG_PUBLICATION_BASE_URL=$FROG_PUBLICATION_BASE_URL
FROG_PUBLICATION_API_KEY=$FROG_PUBLICATION_API_KEY
EOF
  chmod 600 "$ENV_FILE"
  say "配置已写入 $ENV_FILE"
fi

if ! confirm "现在构建并启动服务" "y"; then
  cat <<EOF

稍后执行：
  docker compose --env-file .env.production -f docker-compose.production.yml --profile tools build release web worker && \\
  docker compose --env-file .env.production -f docker-compose.production.yml --profile bundled up -d postgres redis && \\
  docker compose --env-file .env.production -f docker-compose.production.yml stop web worker && \\
  docker compose --env-file .env.production -f docker-compose.production.yml --profile tools run --rm release && \\
  docker compose --env-file .env.production -f docker-compose.production.yml up -d web worker
EOF
  exit 0
fi

say "校验 Compose 配置"
compose config --quiet

say "构建应用镜像"
compose --profile tools build release web worker

if grep -q '^COMPOSE_PROFILES=bundled$' "$ENV_FILE"; then
  say "启动内置 PostgreSQL 与 Redis"
  compose --profile bundled up -d postgres redis
  wait_healthy postgres
  wait_healthy redis
fi

say "停止 Web 与 Worker，等待旧实例退出"
compose stop web worker

say "执行数据库迁移、版本记录、种子和 RLS 检查"
compose --profile tools run --rm release

say "启动 Web 与 Worker"
compose up -d web worker

WEB_PORT="$(sed -n 's/^WEB_PORT=//p' "$ENV_FILE" | tail -1)"
for _ in $(seq 1 60); do
  if curl --fail --silent --show-error "http://127.0.0.1:${WEB_PORT}/api/health/ready" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done

if [[ "${READY:-0}" != "1" ]]; then
  compose logs --tail=120 web worker >&2
  die "服务未在规定时间内就绪"
fi

APP_URL="$(sed -n 's/^APP_URL=//p' "$ENV_FILE" | tail -1)"
say "安装完成"
printf '初始化管理员：%s/setup\n' "$APP_URL"
printf '健康检查：%s/api/health/ready\n' "$APP_URL"
printf '查看状态：docker compose --env-file .env.production -f docker-compose.production.yml ps\n'
