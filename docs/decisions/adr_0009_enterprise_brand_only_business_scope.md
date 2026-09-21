# ADR-0009：企业与品牌作为唯一业务范围

- 状态：accepted
- 日期：2026-09-14
- 决策范围：平台信息架构、租户范围选择、成员授权和腾讯内部兼容绑定
- 扩展：[ADR-0005](./adr_0005_tencent_brand_enterprise_projection.md)

## 背景

每个腾讯 BrandID 已经一一投影为一个平台企业，而所有企业共同复用平台固定 TeamID。此时继续把“团队”作为平台管理资源、租户设置项或成员授权维度，会让用户误以为企业与团队是两个独立业务层级，并产生没有实际选择空间的 TeamID 表单、筛选器和额度。

数据库中的 `answerbit_team_bindings` 仍被业务记录、调用日志和凭证解析外键引用。立即删除该表会扩大迁移范围，却不会改善用户业务模型，因此需要区分业务概念与内部兼容实现。

## 决策

1. 平台业务层级固定为“平台 → 企业 → 企业成员/唯一 Tencent BrandID → 品牌业务数据”，不定义团队业务层级。
2. 固定 TeamID 只在平台“腾讯接入”中配置，用于访问腾讯官方 OpenAPI；平台导航、租户设置、成员授权和统计不提供团队资源。
3. 删除租户与平台的团队管理 API、团队更新契约、团队读写权限和团队资源额度。企业管理员只读查看平台服务、本企业接入和对应 Tencent BrandID。
4. 品牌角色授权不再接收 TeamID 或 BrandID。服务端按 organization 自动解析唯一活动品牌映射，并把内部绑定写入现有外键。
5. 工作台只允许选择企业和品牌。前端从企业目录获得内部范围标识并自动传给尚未迁移的业务 operation API，不展示、缓存独立选择或允许用户修改该标识。
6. `answerbit_team_bindings`、托管 connection 和现有 `team_binding_id` 外键暂时保留为内部兼容层；它们不是公开管理资源，也不改变企业数据边界。

## 取舍

统一为企业与品牌范围后，管理信息架构、成员授权和日常操作与真实业务边界一致，避免用户理解和维护共享 TeamID。服务端自动解析也消除了跨企业误选绑定的入口。

代价是现有 operation API 和数据表仍保留 `teamBindingId`/`team_binding_id` 技术字段，代码需要明确其为不可编辑的内部范围标识。后续若移除这些字段，需要单独的数据迁移和 API 版本演进；本决策不以大规模外键重写阻塞当前业务模型收敛。

## 后果

- `/admin` 不再有“团队中心”，企业详情只展示 Tencent BrandID 与成员。
- `/dashboard` 不再请求团队目录或显示 TeamID 选择器；腾讯设置页改为只读企业接入状态。
- 新增企业成员或品牌权限时，品牌角色自动作用于当前企业唯一品牌。
- `/v1/admin/teams`、`/v1/answerbit/teams` 及其详情、更新和检测端点被移除。
- 平台总览、角色权限和默认资源配置不再统计团队数量。
- 新发布的资源配置版本移除团队额度；既有订阅快照和 append-only 额度流水仅作为历史记录保留，不再参与容量校验。

## 相关文档

- [平台管理架构](../architecture/platform_administration.md)
- [身份与访问控制](../domains/identity_and_access.md)
- [GEO 运营域](../domains/geo_operations.md)
- [腾讯 AnswerBit 集成](../interfaces/answerbit_integration.md)
