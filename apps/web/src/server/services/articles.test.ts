vi.mock("@geo/db", () => ({ assertEnterpriseAccess: vi.fn() }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createArticleJobSchema } from "@geo/contracts";
const m = vi.hoisted(() => ({
  authorize: vi.fn(),
  context: vi.fn(),
  templates: vi.fn(),
  existing: vi.fn(),
  create: vi.fn(),
  enqueue: vi.fn(),
  prepareQueue: vi.fn(),
  quote: vi.fn(),
  list: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock("@/server/permissions/brand-scope", () => ({
  authorizeBrand: m.authorize,
}));
vi.mock("@/server/integrations/answerbit/context", () => ({
  loadAnswerBitTeamContext: m.context,
}));
vi.mock("@/server/integrations/answerbit/gateway", () => ({
  queryArticleTemplatesLogged: m.templates,
}));
vi.mock("@/server/jobs/boss", () => ({
  prepareArticleGenerationQueue: m.prepareQueue,
  cancelArticleGeneration: vi.fn(),
}));
vi.mock("@/server/repositories/articles", () => ({
  articleRepository: {
    findJobByIdempotency: m.existing,
    submitJob: m.create,
    listJobs: m.list,
  },
}));
vi.mock("@/server/security/secret-cipher", () => ({
  getSecretCipher: () => ({
    decrypt: m.decrypt,
    encrypt: (value: string) => value,
  }),
}));
vi.mock("./answerbit-connections", () => ({
  mapUpstreamError: (e: unknown) => {
    throw e;
  },
}));
vi.mock("./feature-billing", () => ({
  assertPointBilledFeatureQuote: m.quote,
}));
vi.mock("@/server/audit/write-audit", () => ({ writeAudit: vi.fn() }));
import { articleService } from "./articles";
const scope = {
  organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  teamBindingId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  brandId: "brand",
};
const input = createArticleJobSchema.parse({
  ...scope,
  expectedPoints: 1,
  templateType: 1,
  promptIds: ["prompt"],
});
beforeEach(() => {
  vi.resetAllMocks();
  m.context.mockResolvedValue({
    connection: { id: "connection" },
    apiKey: "key",
  });
  m.prepareQueue.mockResolvedValue(m.enqueue);
  m.enqueue.mockResolvedValue("queue-job");
  m.decrypt.mockImplementation((value: string) => value);
  m.create.mockImplementation(async (value, options) => ({
    job: {
      ...value,
      id: "job",
      status: "queued",
      queueJobId: await options.enqueue(
        { organizationId: value.organizationId, jobId: "job" },
        {},
      ),
    },
    replayed: false,
  }));
});
describe("文章生成方式校验", () => {
  it("网络失败重试同一任务直接返回原任务，不再投递", async () => {
    const payload = {
      brand_id: input.brandId,
      template_type: input.templateType,
      prompt_ids: input.promptIds,
      knowledge_ids: [],
      tag_ids: [],
      language: input.language,
    };
    m.existing.mockResolvedValue({
      ...scope,
      id: "original-job",
      requestedBy: "user",
      tags: [],
      requestPayload: { ciphertext: JSON.stringify(payload) },
    });
    m.decrypt.mockImplementation((value: string) => value);
    const result = await articleService.createJob(
      input,
      "same-key",
      "user",
      "request",
      { actorUserId: "user", requestId: "request" },
    );
    expect(result).toMatchObject({ id: "original-job", replayed: true });
    expect(m.templates).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
    expect(m.enqueue).not.toHaveBeenCalled();
  });
  it.each([
    { brandId: "other" },
    { requestedBy: "other-user" },
    { templateType: 2 },
  ])("同键不能复用其他品牌、用户或不同生成请求 %j", async (changed) => {
    const payload = {
      brand_id: input.brandId,
      template_type:
        "templateType" in changed ? changed.templateType : input.templateType,
      prompt_ids: input.promptIds,
      knowledge_ids: [],
      tag_ids: [],
      language: input.language,
    };
    m.existing.mockResolvedValue({
      ...scope,
      id: "job",
      requestedBy: "user",
      ...changed,
      tags: [],
      requestPayload: { ciphertext: JSON.stringify(payload) },
    });
    m.decrypt.mockImplementation((value: string) => value);
    await expect(
      articleService.createJob(input, "same-key", "user", "request", {
        actorUserId: "user",
        requestId: "request",
      }),
    ).rejects.toMatchObject({ code: "ARTICLE_JOB_IDEMPOTENCY_CONFLICT" });
    expect(m.create).not.toHaveBeenCalled();
  });
  it.each([0, 1])(
    "匹配的模板类型 %s 正常保存并投递任务",
    async (is_high_ref) => {
      m.templates.mockResolvedValue([{ template_id: 1, is_high_ref }]);
      m.decrypt.mockImplementation((value: string) => value);
      const result = await articleService.createJob(
        {
          ...input,
          highReference: is_high_ref
            ? { url: "https://example.com/article" }
            : undefined,
        },
        "key",
        "user",
        "request",
        { actorUserId: "user", requestId: "request" },
      );
      expect(result.generationMode).toBe(
        is_high_ref ? "reference" : "standard",
      );
      expect(m.enqueue).toHaveBeenCalledWith(
        { organizationId: scope.organizationId, jobId: "job" },
        expect.any(Object),
      );
    },
  );
  it.each([
    [1, undefined, "ARTICLE_REFERENCE_REQUIRED"],
    [
      0,
      { url: "https://example.com/article" },
      "ARTICLE_REFERENCE_NOT_ALLOWED",
    ],
    [2, undefined, "ARTICLE_TEMPLATE_UNAVAILABLE"],
  ] as const)(
    "拒绝模板类型 %s 与参考资料不匹配的请求",
    async (is_high_ref, highReference, code) => {
      m.templates.mockResolvedValue([{ template_id: 1, is_high_ref }]);
      await expect(
        articleService.createJob(
          { ...input, highReference },
          "key",
          "user",
          "request",
          { actorUserId: "user", requestId: "request" },
        ),
      ).rejects.toMatchObject({ code });
      expect(m.create).not.toHaveBeenCalled();
      expect(m.enqueue).not.toHaveBeenCalled();
      expect(m.quote).not.toHaveBeenCalled();
    },
  );
  it("不存在的模板不能提交", async () => {
    m.templates.mockResolvedValue([]);
    await expect(
      articleService.createJob(input, "key", "user", "request", {
        actorUserId: "user",
        requestId: "request",
      }),
    ).rejects.toMatchObject({ code: "ARTICLE_TEMPLATE_UNAVAILABLE" });
  });
  it("队列初始化失败不开始写任务；同键下一次提交可继续", async () => {
    m.templates.mockResolvedValue([{ template_id: 1, is_high_ref: 0 }]);
    m.prepareQueue.mockRejectedValueOnce(new Error("queue unavailable"));
    const create = () =>
      articleService.createJob(input, "same-key", "user", "request", {
        actorUserId: "user",
        requestId: "request",
      });
    await expect(create()).rejects.toMatchObject({
      status: 503,
      code: "ARTICLE_QUEUE_UNAVAILABLE",
    });
    expect(m.create).not.toHaveBeenCalled();
    expect(await create()).toMatchObject({ id: "job", replayed: false });
  });
  it("事务内入队失败返回可重试的队列错误，不把任务改成失败", async () => {
    m.templates.mockResolvedValue([{ template_id: 1, is_high_ref: 0 }]);
    m.enqueue.mockRejectedValueOnce(new Error("queue insert failed"));
    await expect(
      articleService.createJob(input, "key", "user", "request", {
        actorUserId: "user",
        requestId: "request",
      }),
    ).rejects.toMatchObject({ status: 503, code: "ARTICLE_QUEUE_UNAVAILABLE" });
  });
  it("旧的未入队任务使用原内容和价格快照恢复，不重新计价", async () => {
    const existing = {
      ...scope,
      id: "legacy-job",
      requestedBy: "user",
      status: "queued",
      queueJobId: null,
      pricingSnapshot: { points: 3 },
      tags: [],
      requestPayload: {
        ciphertext: JSON.stringify({
          brand_id: input.brandId,
          template_type: input.templateType,
          prompt_ids: input.promptIds,
          knowledge_ids: [],
          tag_ids: [],
          language: input.language,
        }),
      },
    };
    m.existing.mockResolvedValue(existing);
    m.create.mockResolvedValue({
      job: { ...existing, queueJobId: "recovered" },
      replayed: true,
    });
    expect(
      await articleService.createJob(input, "key", "user", "request", {
        actorUserId: "user",
        requestId: "request",
      }),
    ).toMatchObject({ id: "legacy-job", replayed: true, status: "queued" });
    expect(m.create).toHaveBeenCalledWith(existing, expect.any(Object));
    expect(m.templates).not.toHaveBeenCalled();
    expect(m.quote).not.toHaveBeenCalled();
    const options = m.create.mock.calls[0][1];
    expect(() =>
      options.validateReplay({ ...existing, requestedBy: "other" }),
    ).toThrowError("同一幂等键");
  });
  it("历史任务依据已保存的请求区分生成方式，不泄露参考正文", async () => {
    m.list.mockResolvedValue(
      [1, 2, 3].map((id) => ({
        ...scope,
        id,
        requestPayload: { ciphertext: String(id) },
      })),
    );
    const payload = {
      brand_id: "brand",
      template_type: 1,
      prompt_ids: ["prompt"],
      knowledge_ids: [],
      tag_ids: [],
      language: "zh-CN",
    };
    m.decrypt
      .mockReturnValueOnce(JSON.stringify(payload))
      .mockReturnValueOnce(
        JSON.stringify({
          ...payload,
          high_ref: { title: "参考", content: "私有参考正文" },
        }),
      )
      .mockImplementationOnce(() => {
        throw new Error("legacy");
      });
    const jobs = await articleService.listJobs(scope, 20, "user");
    expect(jobs.map((job) => job?.generationMode)).toEqual([
      "standard",
      "reference",
      null,
    ]);
    expect(JSON.stringify(jobs)).not.toContain("私有参考正文");
    expect(JSON.stringify(jobs)).not.toContain("ciphertext");
  });
});
