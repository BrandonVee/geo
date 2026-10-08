# 系统总览

本文描述 AnswerBit GEO SaaS 的系统边界、运行组件和关键数据流，面向新接手工程师与跨模块设计评审；具体领域规则、接口字段和部署命令分别由领域、接口和运维文档负责。

## 导航

- [系统边界](#系统边界)
- [运行组件](#运行组件)
- [同步请求链路](#同步请求链路)
- [异步任务链路](#异步任务链路)
- [部署关系](#部署关系)
- [关键不变量](#关键不变量)

## 系统边界

系统为企业、代理商和品牌成员提供 GEO 运营工作台，并通过腾讯 AnswerBit 获取品牌、监测问题、模型回答、引用和内容能力。平台自身负责账号、租户权限、内部余额、发布履约、报告导出、通知和审计。

系统不承担在线充值、支付收单或第三方支付回调。所有腾讯调用积分和发布人民币余额均由平台管理员人工入账，再由企业管理员或代理商划分到品牌。

## 运行组件

| 组件           | 技术与位置                               | 职责                                                            |
| -------------- | ---------------------------------------- | --------------------------------------------------------------- |
| Web 应用       | Next.js 16、React 19，`apps/web`         | 页面、Better Auth 认证、REST API、应用服务与 AnswerBit 同步调用 |
| Worker         | Node.js、pg-boss，`apps/worker`          | 文章生成、CSV 导出、通知评估、腾讯目录同步、周期维护和运行心跳  |
| 数据库发布任务 | Node.js、Drizzle，`packages/db`          | 执行迁移、记录版本、基础种子与 RLS 验证并推进数据库发布版本     |
| PostgreSQL     | Drizzle schema/migrations，`packages/db` | 业务持久化、只读分析缓存、事务、幂等账本、队列存储和 RLS                      |
| Redis          | Better Auth custom rate-limit storage    | 原子分布式登录限流；会话和账号资料直接读取 PostgreSQL          |
| 契约包         | Zod，`packages/contracts`                | Web 与 API 共用的输入输出约束                                   |
| 核心包         | `packages/core`                          | 权限判断、密钥加解密、请求 ID、CSV、通知与周期任务健康判定工具  |
| 发布集成包     | `packages/publication`                   | Web 与 Worker 共用的媒体发布客户端、批量履约同步与状态映射        |
| 配置包         | `packages/config`                        | 运行环境变量校验                                                |
| 腾讯 AnswerBit | 外部 HTTPS 服务                          | GEO 品牌、监测、分析、文章与上游计量能力                        |
| 媒体发布服务 | 外部 HTTP 服务                           | 网站媒体与自媒体渠道、投稿、履约状态、取消和申诉                |

## 同步请求链路

```text
Browser
  -> Next.js Page / API Route
  -> Session + permission + brand-scope check
  -> Application Service
  -> Repository / AnswerBit Gateway
  -> PostgreSQL and/or Tencent AnswerBit
  -> { data, requestId } or { error, requestId }
```

HTTP Route 仅处理协议、认证上下文、输入校验和响应状态；业务编排进入 Service；持久化与事务进入 Repository。AnswerBit Gateway 负责调用与旁路日志，不做接口级扣费；Service 或 Worker 在完整业务功能边界执行一次积分预扣，并在完整功能失败时幂等返还。

## 异步任务链路

文章生成与报告导出由 Web 写入 PostgreSQL/pg-boss 后交给 Worker。Worker 在执行前重新读取租户、团队、品牌权限和凭证，避免使用提交时的陈旧权限；业务队列负责文章生成、积分结算与结果映射，以及报告生成、文件到期清理与平台额度结算。Worker 另外跟踪五项周期任务：

- 每 5 分钟执行资源周期、额度结算和失败文章积分返还维护；
- 每 5 分钟恢复过期的文章生成与报告导出任务；
- 每 15 分钟评估企业通知规则；
- 每 5 分钟同步聚合发布待履约及售后订单，按最久未同步选取最多 100 条，不依赖页面读取；未配置 Key 时跳过上游工作；
- 每日核对固定 TeamID 的腾讯品牌目录，自动新增或更新企业投影，并在连续两次缺失后关闭腾讯侧已删除的企业投影。

异步恢复把等待超过 10 分钟或执行超过 15 分钟的业务任务作为候选，但会先读取 pg-boss 状态，仍在等待、重试或执行的队列任务不重投。可安全重试的任务回到 `queued`；已扣费且未保存上游 ArticleID 的文章任务标记为结果不确定并幂等退款，避免重复创建。文章和报告每次领取都生成 `execution_id`，所有后续写入以该执行租约作为条件，恢复前的迟到 Worker 不能覆盖新执行结果。

每个 Worker 实例启动完成后写入 `runtime_heartbeats`，之后每 30 秒更新一次心跳；优雅退出时删除本实例记录。平台控制台把 90 秒内更新的记录视为在线实例，并把通知规则超过 30 分钟未评估视为持续检测过期。心跳只用于运行观测，不参与任务幂等或业务状态判定。

计费维护、异步任务恢复、通知评估、腾讯企业同步和聚合发布同步每次执行时还以独立 run ID 更新 `runtime_task_statuses`，记录运行中、成功或失败、实例、耗时和稳定错误码。完成写入只允许匹配当前 run ID，较早执行不能覆盖较新的任务状态；跟踪写入失败仅输出结构化日志，不改变原任务结果。平台按任务声明的调度周期和超时阈值区分正常、执行中、失败、过期与未上报，因此 Worker 进程在线不再被等同于所有周期任务都正常。

## 部署关系

最小生产拓扑由一个或多个 Web 实例、至少一个 Worker 实例、PostgreSQL 和 Redis 组成，每次发布前另运行一次数据库发布任务。根目录 `Dockerfile` 提供 `release`、`web` 与 `worker` 三个目标：`release` 使用独立 `MIGRATION_DATABASE_URL` 依次执行迁移、记录 schema 版本、种子和 RLS 检查；Web 使用 Next.js standalone 产物并通过 Redis 共享登录限流，会话直接读取 PostgreSQL；Worker 使用单文件 Node.js bundle且继续以 PostgreSQL/pg-boss 协调任务。三个镜像均以非 root 用户启动，Web 与 Worker 运行镜像不包含构建工具。Web 与 Worker 使用同一 `DATABASE_URL`、`APP_ENCRYPTION_KEY` 和 AnswerBit 基础地址；媒体发布 Key 由平台网页加密保存到 PostgreSQL 后供二者共用，环境变量只作旧部署回退；浏览器只访问 Web，不直接访问数据库、Redis 或上游 API Key。

数据库以 `system_release_state` 保存当前 schema 与 seed 的 `vN` 修订并按数字比较。Web readiness 在配置和连接检查后确认这两个修订不低于应用要求的最低版本，防止新应用在迁移或种子缺失时提前接流；更高修订仍兼容旧应用的 readiness，支持先执行向后兼容迁移再滚动部署。发布任务全部成功后才允许部署 Web 与 Worker。

Web 可横向扩展。首次管理员初始化通过 PostgreSQL 事务级 advisory lock 串行化，多实例并发时仍只允许一次成功。pg-boss 使用 PostgreSQL 协调任务领取。

Web 与 Worker 分别限制业务数据库连接池和 pg-boss 连接池，设置建连/查询超时、空闲回收、连接最长生命周期和 PostgreSQL `application_name`；连接池容量按副本总数纳入部署预算。空闲业务连接和 pg-boss 的后台错误都有结构化事件监听，避免未处理的 EventEmitter 错误直接终止进程，同时由 readiness、Worker 心跳和任务状态反映持续故障。

## 关键不变量

- 所有租户业务请求必须同时经过应用层权限检查和数据库 RLS 边界。
- AnswerBit 使用平台固定 TeamID 与统一加密 API Key；腾讯品牌目录是平台企业的唯一来源，每个 BrandID 自动生成一个内部租户投影；调用前校验企业品牌范围，系统直接使用已接入 OpenAPI，腾讯侧授权以官方控制台为准，解密只发生在服务端。
- 两类余额单位和用途隔离，任何扣减不得产生负余额。
- 余额扣减、返还、发布状态变化和异步任务均使用稳定幂等键。
- 异步任务的状态写入必须匹配当前 `execution_id`；恢复任务不得重复创建结果不确定的上游文章。
- 平台管理员执行全局操作；企业角色不能越过所属企业和授权品牌。
- 当前接口契约由 [OpenAPI 定义](../interfaces/openapi.yaml) 与实现共同约束。
- 媒体发布 API Key 只在平台管理端提交并在服务端解密使用；读取接口只返回掩码。本地发布订单和人民币账本仍是权限、扣款、退款与审计边界。

## 相关文档

- [后端分层](./backend_layers.md)
- [数据与安全架构](./data_and_security.md)
- [身份与访问控制](../domains/identity_and_access.md)
- [余额计费与发布履约](../domains/balance_and_publication.md)
- [部署与运行手册](../operations/deployment_and_runbook.md)
