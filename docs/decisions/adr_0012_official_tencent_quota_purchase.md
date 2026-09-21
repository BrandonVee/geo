# ADR-0012：通过腾讯官方写接口扩容监控品牌

- 状态：accepted
- 日期：2026-09-17
- 决策范围：腾讯监控品牌容量增购、积分副作用、限流与结果确认
- 替代：[ADR-0011](./adr_0011_automatic_tencent_directory_and_admin_metering.md) 的“只估算并跳转腾讯控制台”扩容交互

## 背景

AnswerBit Apifox 项目当前列出的 48 个已发布接口中只有九项计量读取接口，没有配额增购写接口。但腾讯线上官方 Web 客户端的计量页面实际调用 `/geo/billing/quota/purchase`，请求字段为 `team_id`、`quota_type` 和 `quota_amount`；该路由在线存在，并以统一身份凭证保护。官方客户端只允许 `max_brand` 与 `max_member` 增购，其中监控品牌当前按 400 积分/个估算。

原页面因此只提供估算和控制台跳转，和腾讯官方产品已经具备的直接扩容能力不一致。计量页一次刷新还会并发触发多项共享 TeamID 查询，可能先消耗上游速率窗口，使紧接着的扩容请求收到 429。

## 决策

1. 将 `/geo/billing/quota/purchase` 作为“官方 Web 已用、Apifox 尚未发布”的兼容 operation 纳入统一凭证目录；平台当前只开放 `quota_type=max_brand`，单次 `quota_amount` 为 1–9999。
2. 新增 `POST /api/v1/answerbit/metering/quota-purchases`。端点要求 Session、`platform.tenant.manage`、有效企业/内部 Team 绑定和固定 TeamID 统一凭证；请求只在腾讯返回 `code=0` 后成功。
3. 页面继续按 400 积分/个显示预计消耗和预计剩余，并在管理员二次确认后直接提交。该数字用于提交前提示，实际扣减和永久配额以腾讯后端及随后重新读取的积分、用量、流水和配额记录为准；本地不建立第二份腾讯积分扣减或配额账本。
4. 所有腾讯计量调用进入进程内串行队列，浏览器顺序读取计量资源。读取请求及明确被拒绝的 429 按 `Retry-After` 或指数退避有限重试；扩容遇到超时或 5xx 时不自动重放，避免结果已生效但响应丢失造成重复扣减。
5. 成功扩容同时记录 AnswerBit API 调用日志与平台操作审计，随后刷新当前用量、积分和记录列表。

## 取舍

该写接口尚未进入当前 Apifox 发布清单，契约稳定性弱于已发布接口，因此被明确归入兼容 operation，并限制为官方客户端已经使用的字段和监控品牌类型。直接提交减少人工跳转，但共享 TeamID 的积分和配额会真实变化，所以只开放给平台管理员并保留确认、审计和保守重试策略。

串行读取会让完整计量页比全并发加载多等待少量时间，但能显著降低 429，并避免一次失败使整批已成功响应失效。进程内队列不替代腾讯服务端限流；多 Web 实例仍依赖有限退避处理 429。

## 后果

- “确认扩容”是真实腾讯写操作，不再是外链；
- 腾讯成功后页面显示成功提示并自动刷新，配额记录与积分流水仍是最终核对依据；
- 429 会短暂延长读取或提交耗时，重试耗尽后返回稳定的 `ANSWERBIT_RATE_LIMITED`；
- 超时或 5xx 后管理员先刷新计量确认状态，再决定是否重新提交。

## 相关文档

- [腾讯 AnswerBit 集成](../interfaces/answerbit_integration.md)
- [API 约定](../interfaces/api_conventions.md)
- [平台管理架构](../architecture/platform_administration.md)
- [企业级 UI 设计系统](../architecture/ui_design_system.md)
