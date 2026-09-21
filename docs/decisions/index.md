# 架构决策记录

本分类保存已接受架构决策的背景、取舍与后果。ADR 记录决策历史，当前运行规则仍以架构和领域文档为准。

- [ADR-0001：采用人工双余额账本](./adr_0001_manual_dual_balance.md)：取消在线支付，以腾讯积分和发布人民币两个独立人工余额完成资源控制。读取时机：讨论充值、支付、账本合并、积分单位或发布扣费模式时读取。

- [ADR-0002：AnswerBit Key 按 TeamID、资源范围与接口权限管理](./adr_0002_scoped_answerbit_credentials.md)：已由 ADR-0003 替代，保留多 TeamID、多 Key 模型的历史背景。读取时机：追溯旧凭证 assignment 与回退路径时读取。
- [ADR-0003：固定 AnswerBit TeamID 与统一 Key，企业映射腾讯品牌](./adr_0003_fixed_answerbit_team_and_brand_tenants.md)：已由 ADR-0004 替代；保留固定 TeamID、统一 Key 和企业品牌映射的决策背景。读取时机：追溯本地 operation 权限子集的历史设计时读取。
- [ADR-0004：统一 AnswerBit 凭证直接调用已接入 OpenAPI](./adr_0004_direct_answerbit_operations.md)：保留固定 TeamID/Key 和企业—品牌映射，取消平台内的 operation 权限选择与运行时子集校验。读取时机：修改统一凭证、AnswerBit 调用解析、腾讯授权边界或品牌映射时读取。
- [ADR-0005：腾讯品牌目录作为平台企业唯一来源](./adr_0005_tencent_brand_enterprise_projection.md)：将本地企业改为腾讯 BrandID 的自动租户投影，停止独立创建本地企业。读取时机：修改企业创建、腾讯目录同步、租户投影或遗留企业迁移时读取。
- [ADR-0006：腾讯接入作为系统业务就绪门禁](./adr_0006_tencent_connection_readiness_gate.md)：强制先完成腾讯统一接入再开放平台与租户业务，并移除旧配置动作式目录刷新入口；手动同步由 ADR-0007 后续修订。读取时机：修改首次启用流程、全局业务门禁、腾讯配置或平台导航时读取。
- [ADR-0007：恢复腾讯企业立即同步入口](./adr_0007_manual_tencent_enterprise_sync.md)：已由 ADR-0011 替代页面入口，保留运维资源的历史背景。读取时机：追溯手动同步 API、并发控制或旧管理页入口时读取。
- [ADR-0008：按企业收窄用户功能并设置代理商经营额度](./adr_0008_user_enterprise_feature_scopes_and_agent_quotas.md)：保留 RBAC 作为权限上限，以逐企业功能 allowlist 和代理商企业/品牌/腾讯积分额度控制差异化经营范围。读取时机：修改用户授权、功能模块、代理商额度或相关用量校验时读取。
- [ADR-0009：企业与品牌作为唯一业务范围](./adr_0009_enterprise_brand_only_business_scope.md)：移除团队业务层级与管理资源，只保留内部腾讯范围兼容记录。读取时机：修改平台导航、租户范围、成员品牌授权、TeamID 或 `team_binding_id` 兼容字段时读取。
- [ADR-0010：接口免费、按业务功能结算积分](./adr_0010_feature_based_point_billing.md)：AnswerBit operation 只记录调用，品牌余额按完整业务功能一次性结算。读取时机：修改积分价格、功能计费边界或失败返还时读取。
- [ADR-0011：腾讯目录后台同步与平台计量中心](./adr_0011_automatic_tencent_directory_and_admin_metering.md)：以 Worker 自动同步替代日常手动入口，并在平台控制面展示腾讯计量；原扩容跳转已由 ADR-0012 替代。读取时机：修改企业自动同步、管理端计量或本地 Worker 启动方式时读取。
- [ADR-0012：通过腾讯官方写接口扩容监控品牌](./adr_0012_official_tencent_quota_purchase.md)：使用官方 Web 已接入但尚未发布到 Apifox 的配额增购接口，并规定权限、真实副作用、限流与结果确认。读取时机：修改监控品牌扩容、腾讯积分写入或计量限流策略时读取。
- [ADR-0013：将数据库初始化整理为 v1 当前态基线](./adr_0013_squashed_database_baseline.md)：用一份只包含有效对象的 v1 脚本替代旧 0000—0044 演进链，并把 schema/seed 发布记录统一为 `vN`。读取时机：修改 schema、生成迁移、部署历史数据库或处理 Drizzle 迁移记录时读取。
- [ADR-0014：按用户价格等级计算发布售价与功能积分](./adr_0014_user_pricing_tiers_and_channel_margin.md)：分离小青蛙采购成本、平台上下架、四级利润规则与渠道固定价，并把同一用户等级用于完整功能积分系数。读取时机：修改代理等级、聚合渠道售价、平台利润、功能积分折扣或订单价格快照时读取。
