vi.mock("@geo/db", () => ({ assertEnterpriseAccess: vi.fn() }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createArticleJobSchema } from "@geo/contracts";
const m = vi.hoisted(() => ({
  authorize: vi.fn(),
  context: vi.fn(),
  templates: vi.fn(),
  existing: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  enqueue: vi.fn(),
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
  enqueueArticleGeneration: m.enqueue,
  cancelArticleGeneration: vi.fn(),
}));
vi.mock("@/server/repositories/articles", () => ({
  articleRepository: {
    findJobByIdempotency: m.existing,
    createJob: m.create,
    updateJob: m.update,
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
});
describe("文章生成方式校验", () => {
  it.each([0, 1])(
    "匹配的模板类型 %s 正常保存并投递任务",
    async (is_high_ref) => {
      m.templates.mockResolvedValue([{ template_id: 1, is_high_ref }]);
      m.decrypt.mockImplementation((value: string) => value);
      m.create.mockImplementation(async (value) => ({
        ...value,
        id: "job",
        status: "queued",
      }));
      m.update.mockImplementation(async () => m.create.mock.results[0].value);
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
      expect(m.enqueue).toHaveBeenCalledWith({
        organizationId: scope.organizationId,
        jobId: "job",
      });
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
