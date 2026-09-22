# 后端分层

本文规定 Web 后端与共享包的依赖方向、职责边界和事务规则，覆盖新增业务能力时的落位方式；页面布局和具体领域状态机不在本文展开。

## 依赖方向

```text
HTTP Route -> Application Service -> Repository -> PostgreSQL
                               \-> Integration Gateway -> Tencent AnswerBit
Shared contracts/core/config/db/publication packages <- applications
```

依赖只能从协议层指向应用层，再指向持久化或外部集成边界。页面和 Route 不直接执行任意 SQL，Repository 不构造 HTTP 响应，集成模块不决定用户权限。

## 分层职责

| 层             | 主要位置                                                        | 应负责                                     | 不应负责                               |
| -------------- | --------------------------------------------------------------- | ------------------------------------------ | -------------------------------------- |
| Page / Route   | `apps/web/src/app`                                              | UI 组合、HTTP 方法、Session、解析、状态码  | 跨资源事务、散落 SQL、直接保存明文凭证 |
| Service        | `apps/web/src/server/services`、`modules/*/*.service.ts`        | 权限前置条件、业务编排、错误语义、审计意图 | 依赖 React、拼装数据库结构             |
| Repository     | `apps/web/src/server/repositories`、`modules/*/*.repository.ts` | 查询、事务、锁、行级并发与持久化           | HTTP 状态、页面文案、上游协议          |
| Integration    | `apps/web/src/server/integrations`                              | 外部协议适配、超时、响应校验、调用日志     | 租户角色授予、页面状态                 |
| Database       | `packages/db`                                                   | schema、迁移、RLS 上下文、共享事务原语     | Web Session 或视图逻辑                 |
| Contracts/Core | `packages/contracts`、`packages/core`                           | 可复用契约与纯工具                         | 应用专属数据库编排                     |

`packages/publication` 封装小青蛙协议客户端和批量状态协调器，由 Web 与 Worker 共用。协调器依赖注入持久化接口，不直接依赖数据库；品牌权限在 Service 校验，扣款、退款与版本条件更新仍在数据库领域事务内执行。

## 请求与错误边界

Route 为每个请求生成 `requestId`，使用 Zod 契约验证输入，把可预期业务失败转换为 `ApiError`。成功响应采用 `{ data, requestId }`；失败响应采用 `{ error: { code, message, details? }, requestId }`。JSON Route 统一通过 `apiJson` 返回，空响应通过 `emptyResponse` 返回，文件等自定义响应显式写入 `X-Request-ID`；响应头标识必须与响应体、日志和上游调用使用同一个 requestId。未知错误仅在服务端结构化记录，客户端收到统一 `INTERNAL_ERROR`。

Service 使用稳定业务错误码表达可恢复分支，例如初始化冲突、余额不足和资源不存在。Repository 可返回明确的结果联合类型或抛出不可恢复的数据异常，不泄露驱动错误到 HTTP 层。

## 事务与并发

同一业务不变量涉及多次写入时必须由一个 Repository/数据库领域函数持有事务。余额账户更新使用带余额下限条件的原子 `UPDATE`；幂等键在事务中先查重并受数据库唯一约束保护。状态机更新同时匹配旧状态，防止并发覆盖。

租户查询通过 `withTenantDbContext` 设置事务级角色和上下文；平台查询通过 `withPlatformDbContext`。`set local role` 与 `set_config(..., true)` 只在事务内有效，不得在连接级保留租户状态。

## 异步边界

需要较长执行时间、可重试或生成文件的任务进入 pg-boss，不在 HTTP 请求内等待。任务载荷只携带稳定标识符，Worker 执行时重新读取权限和配置。外部副作用与账本变化必须分别拥有可重放的请求 ID/幂等键。

## 模块新增准则

1. 在 `packages/contracts` 定义跨边界输入输出并补充单元测试。
2. 在 Service 声明权限和业务分支，在 Repository 封装数据访问。
3. 涉及租户数据时选择正确数据库上下文并验证 RLS。
4. 外部 API 通过 Integration Client/Gateway 适配，统一超时、校验、日志和计费。
5. Route 只做协议映射，并同步 [API 约定](../interfaces/api_conventions.md) 与 OpenAPI。
6. 跨模块规则改变时同步对应领域文档或 ADR。
