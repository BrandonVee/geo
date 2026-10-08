import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InvalidAnswerBitEnvelopeError,
  BoundedJsonResponseError,
} from "@geo/core";
const mocks = vi.hoisted(() => ({ begin: vi.fn(), receipt: vi.fn() }));
vi.mock("@geo/db", () => ({
  beginArticleCreate: mocks.begin,
  recordArticleCreateReceipt: mocks.receipt,
}));
import {
  createArticleOnce,
  ArticleCreationUncertainError,
} from "./article-create";
import {
  AnswerBitHttpError,
  AnswerBitBusinessError,
  InvalidAnswerBitDataError,
} from "./answerbit-response";

describe("文章创建不可重复派发与不确定结果", () => {
  const input = { organizationId: "org", jobId: "job", executionId: "lease" };
  const dispatchedAt = new Date("2026-01-01T00:00:00Z");
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.begin.mockResolvedValue(dispatchedAt);
    mocks.receipt.mockResolvedValue(true);
  });
  it("先持久化派发，使用任务编号关联上游，回执成功入库后才交付ID", async () => {
    const send = vi.fn().mockResolvedValue({ id: "upstream" });
    const result = await createArticleOnce(
      input,
      async ({ requestId, beforeSend }) => {
        expect(requestId).toBe(input.jobId);
        await beforeSend();
        expect(mocks.begin).toHaveBeenCalledWith(input);
        return send();
      },
    );
    expect(send).toHaveBeenCalledOnce();
    expect(mocks.receipt).toHaveBeenCalledWith({
      ...input,
      dispatchedAt,
      articleId: "upstream",
    });
    expect(result).toEqual({ kind: "created", articleId: "upstream" });
  });
  it("同一租约已有派发或租约已丢失时跳过，不能结束另一个仍在执行的调用", async () => {
    mocks.begin.mockResolvedValue(null);
    const send = vi.fn();
    const result = await createArticleOnce(input, async ({ beforeSend }) => {
      await beforeSend();
      return send();
    });
    expect(result).toEqual({ kind: "skipped" });
    expect(send).not.toHaveBeenCalled();
    expect(mocks.receipt).not.toHaveBeenCalled();
  });
  it.each([
    new TypeError("connection reset"),
    new DOMException("timeout", "TimeoutError"),
    new AnswerBitHttpError(408),
    new AnswerBitHttpError(500),
    new AnswerBitHttpError(502),
    new AnswerBitHttpError(503),
    new AnswerBitHttpError(504),
    new InvalidAnswerBitEnvelopeError(),
    new InvalidAnswerBitDataError(),
    new BoundedJsonResponseError("INVALID_JSON"),
    new BoundedJsonResponseError("BODY_TOO_LARGE"),
  ])("派发后错误 %s 为结果不确定，绝不自动重发", async (error) => {
    const send = vi.fn().mockRejectedValue(error);
    await expect(
      createArticleOnce(input, async ({ beforeSend }) => {
        await beforeSend();
        return send();
      }),
    ).rejects.toBeInstanceOf(ArticleCreationUncertainError);
    expect(send).toHaveBeenCalledOnce();
    expect(mocks.receipt).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 422, 429])(
    "明确 HTTP %i 拒绝保留普通失败语义",
    async (status) => {
      const error = new AnswerBitHttpError(status);
      await expect(
        createArticleOnce(input, async ({ beforeSend }) => {
          await beforeSend();
          throw error;
        }),
      ).rejects.toBe(error);
    },
  );
  it("明确业务拒绝保留普通失败，派发前凭证错误不伪称已调用上游", async () => {
    const error = new AnswerBitBusinessError(1001);
    await expect(
      createArticleOnce(input, async ({ beforeSend }) => {
        await beforeSend();
        throw error;
      }),
    ).rejects.toBe(error);
    const local = new Error("CREDENTIAL_UNAVAILABLE");
    await expect(
      createArticleOnce(input, async () => {
        throw local;
      }),
    ).rejects.toBe(local);
    expect(mocks.begin).toHaveBeenCalledOnce();
  });
  it("有效ID入库异常也属于不确定，迟到回执不恢复已结束租约", async () => {
    mocks.receipt.mockRejectedValueOnce(new Error("database unavailable"));
    const create = async ({
      beforeSend,
    }: {
      beforeSend: () => Promise<void>;
    }) => {
      await beforeSend();
      return { id: "real-id" };
    };
    await expect(createArticleOnce(input, create)).rejects.toBeInstanceOf(
      ArticleCreationUncertainError,
    );
    mocks.receipt.mockResolvedValue(false);
    expect(await createArticleOnce(input, create)).toEqual({ kind: "skipped" });
  });
});
