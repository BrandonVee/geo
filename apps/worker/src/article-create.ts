import { beginArticleCreate, recordArticleCreateReceipt } from "@geo/db";
import { isConfirmedAnswerBitRejection } from "./answerbit-response";

class ArticleDispatchSkippedError extends Error {}
export class ArticleCreationUncertainError extends Error {
  constructor() {
    super("ANSWERBIT_CREATE_UNCERTAIN");
  }
}

// @project-doc docs/domains/geo_operations.md#article_jobs
export async function createArticleOnce(
  input: { organizationId: string; jobId: string; executionId: string },
  create: (options: {
    requestId: string;
    beforeSend: () => Promise<void>;
  }) => Promise<{ id: string }>,
) {
  let dispatchedAt: Date | null = null;
  try {
    const created = await create({
      requestId: input.jobId,
      beforeSend: async () => {
        const acquired = await beginArticleCreate(input);
        if (!acquired) throw new ArticleDispatchSkippedError();
        dispatchedAt = acquired;
      },
    });
    if (!dispatchedAt) throw new Error("ARTICLE_DISPATCH_NOT_RECORDED");
    const active = await recordArticleCreateReceipt({
      ...input,
      dispatchedAt,
      articleId: created.id,
    });
    return active
      ? { kind: "created" as const, articleId: created.id }
      : { kind: "skipped" as const };
  } catch (error) {
    if (error instanceof ArticleDispatchSkippedError)
      return { kind: "skipped" as const };
    if (dispatchedAt && !isConfirmedAnswerBitRejection(error))
      throw new ArticleCreationUncertainError();
    throw error;
  }
}
