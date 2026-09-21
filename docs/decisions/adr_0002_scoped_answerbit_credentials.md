# ADR-0002：AnswerBit Key 按 TeamID、资源范围与接口权限管理

- 状态：superseded
- 日期：2026-09-13
- 决策范围：腾讯 AnswerBit 凭证、租户归属和调用授权
- 被替代：[ADR-0003](./adr_0003_fixed_answerbit_team_and_brand_tenants.md)

## 背景

旧实现只有一把全平台 AnswerBit API Key，并为企业维护加密执行镜像。该模型不能表达腾讯侧“Key 按 TeamID 创建”的事实，也不能区分 Key 是覆盖团队全部品牌还是只覆盖一个品牌，更不能在本地预先阻止 Key 调用未授权的 OpenAPI。

## 决策

1. Key 只由平台管理员创建，每把 Key 必须关联一个全局唯一 TeamID 和其所属企业；同一密钥指纹不能分配给不同 TeamID；
2. 使用 `answerbit_credential_assignments` 将密文连接关联到 TeamID，并记录 `team` 或 `brand` 资源范围、可调用的精确 operation 列表和优先级；
3. 品牌请求优先选择 BrandID 精确匹配的品牌级 Key，再回退到团队级 Key；无品牌的团队操作只允许团队级 Key；
4. 资源范围通过后仍必须验证精确 operation 权限，范围与接口权限均不隐含对方；
5. Web Gateway 和 Worker 在每次上游调用前独立解析 Key，并将实际命中的 connectionId 写入调用日志；
6. 旧 `platform_answerbit_credentials` 单例退出运行路径。迁移为旧团队创建带 `*` 权限的团队级兼容 assignment；新建和更新禁止通配权限。

## 取舍

每次调用解析 Key 增加一次数据库查询，但保持异步任务、权限轮换和禁用状态实时生效，避免把已解密凭证固化到任务载荷或长生命周期上下文。品牌级优先允许同一团队针对品牌逐步切换专用 Key，团队级回退则保留共享 Key 的运维便利。

采用精确 operation 列表比粗粒度读写角色更冗长，但权限含义直接对应腾讯 OpenAPI，新增上游能力时必须显式纳入目录和 Key 配置，减少越权调用和隐式授权。

## 后果

- 平台管理端以 Key 集合而非单例表单呈现，创建时同时指定企业、TeamID、范围和 operation 权限；
- 企业端不再创建 TeamID 或执行 Key 检测，只查看接入状态并维护允许的本地团队设置；
- `/geo/query/brand` 同步要求团队级 Key 显式拥有该 operation；只有品牌级 Key 的 TeamID 不能执行团队目录同步；
- 缺失 Key、范围不符和接口权限不足分别使用独立错误码；
- `APP_ENCRYPTION_KEY` 与企业 ID AAD 继续保护密文，任何读取接口只返回掩码；
- 未来移除旧单例表和 `*` 兼容 assignment 前，需要完成旧数据显式权限迁移并另行记录迁移决策。

## 相关文档

- [数据与安全架构](../architecture/data_and_security.md)
- [平台管理架构](../architecture/platform_administration.md)
- [GEO 运营域](../domains/geo_operations.md)
- [腾讯 AnswerBit 集成](../interfaces/answerbit_integration.md)
