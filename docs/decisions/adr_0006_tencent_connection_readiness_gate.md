# ADR-0006：腾讯接入作为系统业务就绪门禁

- 状态：accepted
- 日期：2026-09-13
- 决策范围：平台启用顺序、业务 API 就绪条件与腾讯目录导入
- 扩展：[ADR-0004](./adr_0004_direct_answerbit_operations.md)、[ADR-0005](./adr_0005_tencent_brand_enterprise_projection.md)
- 后续修订：[ADR-0007](./adr_0007_manual_tencent_enterprise_sync.md) 恢复接入成功后的立即目录同步入口；[ADR-0009](./adr_0009_enterprise_brand_only_business_scope.md) 移除团队业务资源。两项修订均不改变本 ADR 的就绪门禁

## 背景

固定 TeamID 和统一 API Key 是所有腾讯能力及平台企业投影的基础。若接入前仍开放用户、余额、发布等平台模块，会产生没有腾讯企业范围的孤立配置；同时单独的“从腾讯刷新”让管理员误以为企业管理依赖反复同步，而不是直接调用腾讯品牌接口。

## 决策

1. 固定 TeamID 与统一 API Key 必须存在且统一配置状态为 `active`，系统才进入业务就绪状态。
2. 未就绪时，平台管理员自动进入 `/admin?section=integration`，平台导航只开放“腾讯接入”，客户工作台入口禁用；其他账号的 Dashboard 展示等待接入状态。
3. 除统一腾讯配置读取和写入外，业务 API 在 Session 校验后执行全局就绪检查；平台 Service 同时保留服务端门禁，失败返回 `422 PLATFORM_TENCENT_CONNECTION_REQUIRED`。
4. `PUT /v1/admin/answerbit-configuration` 在一个配置流程中完成 `/geo/query/brand` 验证、已有品牌目录导入、缺失企业投影创建及连接健康更新。
5. 删除旧的 `POST /v1/admin/answerbit-configuration/sync`、管理页“从腾讯刷新”按钮及重复的接入页企业目录操作。接入完成后的企业新增、编辑、删除只在“腾讯企业”中心通过腾讯品牌写接口执行。本条关于完全移除手工目录核对的部分后由 ADR-0007 修订。
6. API Key 轮换复用同一配置流程重新验证并导入已有品牌；TeamID 首次配置后保持锁定。

## 取舍

强制顺序避免在腾讯资源边界建立前产生平台业务数据，并把管理员操作收敛为清晰的“先接入、后管理”。代价是腾讯统一配置失效时平台业务也会暂停，运维恢复必须先在腾讯接入页重新验证 Key。

删除人工刷新后不再提供任意时刻的目录拉取入口。系统仍在首次配置和 Key 轮换时导入上游已有品牌，而日常企业变化全部通过本平台的腾讯直连接口产生，因此无需额外刷新动作。

## 后果

- 新部署完成首个管理员初始化后，首次进入平台管理会直接进入腾讯接入。
- 接入成功前，企业、用户、余额、发布、审计和租户业务 API 返回稳定的前置条件错误。
- 接入页只管理 TeamID、Key 和接入状态；腾讯企业 CRUD 集中在企业中心。
- OpenAPI 在本决策落地时不再包含旧配置动作式同步端点；ADR-0007 后续增加资源式立即同步端点。

## 相关文档

- [平台管理架构](../architecture/platform_administration.md)
- [数据与安全架构](../architecture/data_and_security.md)
- [API 约定](../interfaces/api_conventions.md)
- [腾讯 AnswerBit 集成](../interfaces/answerbit_integration.md)
- [企业级 UI 设计系统](../architecture/ui_design_system.md)
