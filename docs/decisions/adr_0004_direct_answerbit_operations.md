# ADR-0004：统一 AnswerBit 凭证直接调用已接入 OpenAPI

- 状态：accepted
- 日期：2026-09-13
- 决策范围：腾讯 AnswerBit 统一凭证、OpenAPI 授权边界与企业品牌隔离
- 替代：[ADR-0003](./adr_0003_fixed_answerbit_team_and_brand_tenants.md)

## 背景

平台与腾讯 AnswerBit 是系统级直接对接：一组固定 TeamID 和 API Key 服务全部本地企业，不同企业通过不同 Tencent BrandID 隔离上游资源。原设计又在平台配置页维护一份 operation 权限子集，并在 Web Gateway 与 Worker 调用前重复校验。

这份本地子集与腾讯官方控制台的 Key 授权容易漂移，会在上游已授权时仍产生本地拒绝，也使新增已接入能力需要额外的人工配置。对于这种系统级对接，本地仍必须保留企业和品牌范围校验，但没有必要复制腾讯的 Key 权限控制面。

## 决策

1. 继续使用一组平台固定 Tencent TeamID 和一把加密 API Key；继续以企业与 Tencent BrandID 一对一映射隔离上游业务资源。
2. `PUT /v1/admin/answerbit-configuration` 的请求只接受 `teamId` 和 `apiKey`。平台管理页移除 operation 权限选择器，并说明腾讯官方控制台是最终授权边界。
3. 统一凭证存在时，Web Gateway 和 Worker 在验证凭证状态、固定 TeamID 与企业 BrandID 范围后，直接调用代码中 `answerBitOperations` 已接入的 operation；不再根据存储的 `permissions` 子集拒绝调用。
4. 腾讯官方控制台负责决定 Key 实际可调用的 OpenAPI。官方权限缺失时，保留上游 401/403 或业务错误，并通过现有调用日志与健康视图排查。
5. `platform_answerbit_credentials.permissions` 列为了兼容已有数据、回滚和旧客户端暂时保留。每次保存时服务端自动写入完整 `answerBitOperations` 目录，读取时兼容字段也返回该完整目录。
6. 旧 `answerbit_credential_assignments` 回退路径仍保留原有 permissions 判断，只用于统一凭证尚未配置的迁移兼容环境。

## 取舍

取消本地 operation 子集后，系统接入的新能力不再因管理页漏配而被本地拒绝，凭证配置和故障定位也更简单。代价是本地不再能对同一把平台 Key 做比腾讯官方更细的 operation 禁用。

该取舍不改变企业和品牌的本地安全边界：请求仍必须通过 Session/RBAC、企业成员关系、固定 TeamID 一致性和 BrandID 归属验证。

## 后果

- `/admin`“腾讯接入”只录入 TeamID 和 API Key，不再展示 OpenAPI 多选权限。
- 上线新 AnswerBit operation 时，需同时完成代码接入和腾讯官方控制台授权，不需要修改平台内的凭证权限子集。
- 统一凭证启用后不再产生本地 `ANSWERBIT_KEY_PERMISSION_DENIED`；上游授权失败按现有 AnswerBit 错误归一化和告警处理。
- 不需要数据库迁移；旧 permissions 数据不再阻断统一凭证调用。

## 相关文档

- [腾讯 AnswerBit 集成](../interfaces/answerbit_integration.md)
- [平台管理架构](../architecture/platform_administration.md)
- [数据与安全架构](../architecture/data_and_security.md)
- [GEO 运营域](../domains/geo_operations.md)
