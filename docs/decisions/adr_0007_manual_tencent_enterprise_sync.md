# ADR-0007：恢复腾讯企业立即同步入口

- 状态：superseded（平台页面入口由 [ADR-0011](./adr_0011_automatic_tencent_directory_and_admin_metering.md) 替代；运维 API 保留）
- 日期：2026-09-13
- 决策范围：腾讯企业目录人工核对、自动同步与平台写入一致性
- 修订：[ADR-0006](./adr_0006_tencent_connection_readiness_gate.md) 的手工目录刷新条款
- 后续替代：[ADR-0011](./adr_0011_automatic_tencent_directory_and_admin_metering.md) 移除日常管理页面的手动入口并保留运维资源

## 背景

Worker 已每 5 分钟自动核对腾讯品牌目录，平台企业 CRUD 也始终先调用腾讯。但管理员可能直接在腾讯控制台调整品牌，或在排障时需要立即确认目录，不适合等待下一次周期任务。旧的配置动作式 `/answerbit-configuration/sync` 容易让人误解为接入流程的一部分，因此不恢复该接口形态。

## 决策

1. 腾讯统一配置达到 `active` 后，腾讯企业中心展示“立即同步”；未接入或凭证异常时入口禁用。
2. `POST /v1/admin/answerbit-enterprise-syncs` 表示创建并同步完成一次目录核对，不接收 TeamID、API Key 或企业参数，始终使用当前统一凭证。
3. 手动入口、5 分钟自动任务与配置保存复用 `syncTencentEnterpriseDirectory`，共享 advisory lock、凭证 `key_version`、企业投影和连续缺失两次后关闭规则。
4. 手动同步执行腾讯 `/geo/query/brand`，返回目录总数及新增、更新、关闭、待确认数量，并写入平台审计。
5. 手动同步不是新的企业 CRUD 入口；企业新增、编辑和删除仍使用腾讯品牌接口，上游成功后才维护平台投影。

## 取舍

立即同步缩短了腾讯控制台变更进入平台的等待时间，并提供明确的人工排障手段。代价是管理员可主动增加一次上游请求，因此仍需接受腾讯限流和超时语义；按钮在请求执行期间禁用，服务端并发由数据库锁和 Key 版本校验处理。

## 后果

- 自动同步仍是默认一致性机制，不依赖管理员点击按钮。
- 管理员点击后页面重新加载腾讯企业目录，并显示本次同步计数。
- 旧 `/answerbit-configuration/sync` 保持删除状态，新端点使用资源名而非动作名。
- 系统继续使用 PostgreSQL 与 pg-boss 承载周期任务和并发协调，不增加 Redis 依赖。

## 相关文档

- [平台管理架构](../architecture/platform_administration.md)
- [API 约定](../interfaces/api_conventions.md)
- [腾讯 AnswerBit 集成](../interfaces/answerbit_integration.md)
- [部署与运行手册](../operations/deployment_and_runbook.md)
