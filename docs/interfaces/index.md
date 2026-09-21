# 接口文档

本分类定义系统对外 HTTP 契约与上游集成边界。

- [API 约定](./api_conventions.md)：统一资源路径、认证、响应、错误、幂等和范围参数。读取时机：新增或修改 API Route、契约 Schema、状态码或联调逻辑时读取。
- [腾讯 AnswerBit 集成](./answerbit_integration.md)：定义凭证、请求、校验、计费、日志和故障处理。读取时机：修改 AnswerBit Client、Gateway、模块适配或连接管理时读取。
- [小青蛙聚合发布集成](./frog_publication_integration.md)：定义媒体渠道同步、HTML 投稿、订单状态、取消、申诉与结果不确定语义。读取时机：修改发布渠道、发布订单或小青蛙 API 适配时读取。
- [OpenAPI 定义](./openapi.yaml)：列出当前已实现 HTTP API 的机器可读契约。读取时机：生成客户端、接口联调、自动化验证或审查路由覆盖时读取。
