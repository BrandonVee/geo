# ADR-0010：接口免费、按业务功能结算积分

- 状态：accepted
- 日期：2026-09-15
- 决策范围：腾讯能力的功能积分计费

> 修订说明：本文“按完整业务功能而非 HTTP 接口计费”的决策继续有效；第 5 条“不维护价格档位”已由 [ADR-0014](./adr_0014_user_pricing_tiers_and_channel_margin.md) 的用户价格等级替代，积分计算现由 [ADR-0015](./adr_0015_point_markup_pricing.md) 的等级加价率决定。

## 背景

原实现把 AnswerBit operation 直接映射为积分价格。一个用户功能可能包含创建、查询、分页、轮询和重试等多个 operation，按接口扣费会使同一功能因实现细节产生不同费用，也会让接口重试重复影响客户余额。

平台只需要对用户可理解的完整业务功能结算积分，不按套餐划分企业或品牌，也不应让底层 HTTP operation 数量改变同一功能的价格。

## 决策

1. AnswerBit Gateway 与 Worker 的接口调用层不读取积分价格、不扣减或返还本地积分；
2. 使用 `feature_point_costs` 按稳定的 `feature_code` 保存功能价格；
3. 完整业务功能以 `featureCode + referenceId` 幂等预扣一次，失败按原金额返还；
4. AI 文章生成按一个任务计费，效果追踪按一次创建计费；内部轮询、分页和重试免费；
5. 平台不维护品牌套餐、价格档位、赠送积分或品牌/席位加购计费；未公布价格的未来功能默认 0，配置价格且实现功能入口后才扣费；
6. 继续保留接口调用日志用于可观测和上游对账，但日志与本地功能积分流水分离。

## 后果

- 用户积分流水显示功能名称，不再显示某个 `/geo/*` operation 作为扣费原因；
- 单次功能的上游调用次数变化不会改变价格；
- 新功能需要先进入 `billableFeatures` 目录，再在业务 Service 或 Worker 接入统一功能结算器；
- 企业和品牌能力不受本地商业套餐矩阵约束，余额来源继续使用平台人工入账与企业到品牌的划拨；
- 历史 `answerbit_point_costs` 由迁移 `0037` 重命名并转换，文章生成与效果追踪沿用对应历史价格，其余旧 operation 价格删除；
- `/v1/admin/feature-point-costs` 是唯一的功能价格管理接口，旧接口级价格路径已移除。

## 相关文档

- [余额计费与发布履约](../domains/balance_and_publication.md)
- [腾讯 AnswerBit 集成](../interfaces/answerbit_integration.md)
- [ADR-0001：采用人工双余额账本](./adr_0001_manual_dual_balance.md)
