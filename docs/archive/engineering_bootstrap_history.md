# 工程初始化说明（历史归档）

> 归档声明：本文只记录早期工程阶段，不作为当前功能或待办依据。当前启动、账号初始化和分层规则以根目录 `README.md`、[本地开发](../operations/local_development.md)、[身份与访问控制](../domains/identity_and_access.md)和[后端分层](../architecture/backend_layers.md)为准。

已按技术设计创建 pnpm workspace：`apps/web` 为 Next.js Web/API，`apps/worker` 为 pg-boss Worker，`packages/db` 为 Drizzle PostgreSQL 数据模型，`packages/contracts`、`core`、`config` 用于共享边界。

## 当前可用

- `/api/health/live`：进程存活检查
- `/api/health/ready`：PostgreSQL 依赖检查
- Better Auth 手机号 OTP 登录、Session 和腾讯云短信发送器
- 登录页、工作台与企业创建表单
- 企业列表、创建、详情与更新 API，含服务端成员权限校验
- AnswerBit API Key AES-256-GCM 加密、掩码、指纹去重和验证后轮换
- 多 TeamID 验证、默认团队约束、依赖检查、品牌数量同步和管理页面
- AnswerBit 调用日志与连接操作审计
- 手机号成员邀请、登录自动接受、成员状态与品牌级授权
- 最后一名企业管理员保护和 TeamID 邀请依赖检查
- 品牌同步、创建、全量更新、本地映射缓存与品牌级数据过滤
- 竞品增删改查、全量更新语义、本地映射缓存与审计日志
- GEO 核心指标、提及率/曝光趋势、竞品排行和动态平台筛选
- 监控问题分类、单条/批量问题、启停、移动与删除全链路
- 大模型回答记录、回答原文详情、引用域名与引用文章排行
- `/dashboard/monitoring` 问题库和 `/dashboard/answers` 回答证据界面
- 文章追踪、游标分页、追踪详情、模板与正文接口
- pg-boss 文章生成队列、加密任务参数、幂等提交、Worker 生成与结果回填
- `/dashboard/content` 内容机会、追踪录入、任务轮询和生成结果审核界面
- AnswerBit 9 个计量接口、品牌权限过滤与 `/dashboard/metering` 上游计量中心
- 内部资源上限配置、企业资源快照与不可变额度流水
- 文章生成额度预占、成功确认、失败/取消释放
- 全局 `platform_user_roles` 与数据库权限矩阵，平台权限不依赖企业成员关系
- `/admin` 平台管理端：企业、用户、企业余额入账、腾讯积分单价、发布渠道、发布履约、审计和 AnswerBit 调用健康
- 企业冻结立即阻断租户 API；用户停用同时撤销全部 Session
- 腾讯调用积分与发布人民币分双账本；平台管理员入账、企业管理员或代理商向品牌划分
- AnswerBit 接口积分单价配置、调用前原子扣减、失败幂等返还
- 发布渠道人民币价格、品牌发布单、履约状态机，以及失败/取消后的余额返还
- pg-boss 每 5 分钟执行资源周期和文章额度结算补偿
- 操作审计、余额流水、非负约束与租户隔离策略
- 用户级保存视图 CRUD、单页默认视图约束及品牌权限复核
- 回答/引用排行异步 CSV 导出、两阶段权限校验、公式注入防护、24 小时文件过期与额度结算
- 企业管理员可配置积分不足、连接连续失败和核心指标异常阈值；请求链路与 Worker 定时双通道评估、冷却去重、品牌可见性隔离及用户级已读状态
- `geo_tenant_app` / `geo_platform_app` 独立数据库角色、租户业务表 RLS 策略、事务级上下文 helper 与可执行跨租户读写检查
- 关键表的 Drizzle Schema：认证、用户、企业、成员、角色权限、短信日志、AnswerBit 连接/TeamID、品牌授权、文章任务
- `AnswerBitProvider` 接口和统一 POST Client
- Docker Compose PostgreSQL 18

## 后续实现顺序

1. 将现有 Repository 按模块迁移到 RLS 事务上下文，并接入 CI 跨租户测试矩阵；
2. 补充多角色、跨品牌的通知与导出 CI 隔离矩阵。
