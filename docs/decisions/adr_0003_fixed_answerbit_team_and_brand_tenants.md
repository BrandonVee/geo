# ADR-0003：固定 AnswerBit TeamID 与统一 Key，企业映射腾讯品牌

- 状态：superseded
- 日期：2026-09-13
- 决策范围：腾讯 AnswerBit 凭证、企业创建、品牌数据范围与官方接口权限
- 替代：[ADR-0002](./adr_0002_scoped_answerbit_credentials.md)
- 被替代：[ADR-0004](./adr_0004_direct_answerbit_operations.md)

## 背景

实际腾讯接入只需要一个 TeamID 下创建的一把 API Key。平台租户不是腾讯团队的镜像：本地“企业”承担成员、权限、余额和业务数据隔离，而不同企业实际对应固定腾讯团队中的不同 BrandID。继续让每家企业维护独立 TeamID、团队级或品牌级 Key 会产生重复密钥、错误的上游资源归属和不必要的轮换成本。

腾讯侧已经提供 Key 可调用 OpenAPI 的权限限制，因此本平台需要保存并执行同一份精确 operation 白名单，而不是再用多把 Key 表达本地企业隔离。

## 决策

1. `platform_answerbit_credentials` 保存唯一固定 TeamID、唯一加密 API Key、精确腾讯 OpenAPI operation 权限及健康状态；完整密钥使用独立平台 AAD 加密，读取接口只返回掩码。
2. 平台配置或轮换 Key 时，必须先使用 `/geo/query/brand` 验证 TeamID、Key 和腾讯侧权限，并同步 `platform_answerbit_brands` 官方品牌目录；权限列表必须包含品牌查询 operation。
3. 创建本地企业时必须选择一个目录中尚未分配的 Tencent BrandID。企业、首位 `tenant_admin`、共享 TeamID 本地绑定和品牌映射在同一事务中创建；BrandID 全局只能绑定一个企业，单个企业也只能拥有一个该类映射。
4. 每家企业仍保留一条 `answerbit_team_bindings` 和托管连接占位记录，用于现有业务外键、调用日志和本地范围解析；这些记录不保存统一 Key 的副本。同一个固定 TeamID 允许出现在不同企业的本地绑定中。
5. Web Gateway 与 Worker 调用前验证：企业绑定属于固定 TeamID、请求 BrandID 属于当前企业、统一 Key 状态有效、permissions 包含精确 operation；随后解密全局密钥。租户品牌目录只返回本企业已绑定的 BrandID，不暴露同一腾讯团队的其他品牌。
6. 固定 TeamID 已有品牌分配后不可变更；企业端不能停用或解绑固定 TeamID，也不能在该团队下自行创建腾讯品牌。统一 Key 的轮换、官方权限和品牌目录同步只在平台控制面维护。
7. 原 `answerbit_credential_assignments` 及按 TeamID Key 管理接口仅保留迁移兼容读取。在统一配置存在时，其创建、更新和停用写入固定返回已弃用，不再参与正常解析；未完成迁移的部署仍可临时回退旧解析路径。

## 取舍

统一密钥显著降低配置和轮换成本，并使本地企业概念与腾讯 BrandID 对齐。代价是密钥失效会影响全部企业，因此同步检测、权限最小化、密钥轮换和告警必须作为平台级运维动作处理。

在每个企业保留固定 TeamID 的本地绑定会产生重复 TeamID 值，但能够复用现有领域外键、品牌权限、余额和调用日志，不需要把所有业务表改为直接引用平台品牌目录。通过 `(organization_id, team_id)` 唯一约束和 BrandID 全局唯一约束维持正确边界。

精确 operation 权限依赖腾讯官方权限配置与本地白名单保持一致。本地检查用于提前阻止未授权调用，不替代腾讯侧最终授权；新增能力必须同时更新 operation 目录和统一 Key 的官方权限。

## 后果

- `/admin`“腾讯接入”从 Key 清单改为单例配置表单和官方品牌目录；企业创建表单必须选择未绑定品牌。
- `/v1/admin/answerbit-configuration` 成为统一配置的读写资源；同步端点每次只处理一个固定 TeamID。
- `answerbit_team_bindings.team_id` 从全局唯一改为企业内唯一，`answerbit_brand_mappings.brand_id` 增加全局唯一约束。
- 企业端继续显示本企业接入状态和品牌，但不再提供固定 TeamID 的停用、解绑或腾讯品牌创建操作；平台可为历史未绑定企业补充 BrandID。
- 平台级同步不归属某个企业、不扣减租户积分，只写平台审计；正常业务调用仍以企业占位 connectionId 记录调用并按品牌计费。

## 相关文档

- [平台管理架构](../architecture/platform_administration.md)
- [数据与安全架构](../architecture/data_and_security.md)
- [GEO 运营域](../domains/geo_operations.md)
- [腾讯 AnswerBit 集成](../interfaces/answerbit_integration.md)
