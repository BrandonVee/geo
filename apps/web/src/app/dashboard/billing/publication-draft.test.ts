import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPublicationDraft,
  publicationBodyHtml,
  readPublicationDraft,
  writePublicationDraft,
} from "./publication-draft";
import { PublicationAttempt } from "./publication-attempt";

const storage = new Map<string, string>();
const scope = {
  userId: "user",
  organizationId: "enterprise",
  brandId: "brand",
};
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("投稿草稿与安全重试", () => {
  it("刷新和渠道往返保留稿件及同一次投稿的幂等键", () => {
    const attempt = new PublicationAttempt();
    const payload = { title: "品牌文章", contentHtml: "正文" };
    const key = attempt.key(payload);
    writePublicationDraft(scope, {
      values: payload,
      bodyFormat: "text",
      updatedAt: Date.now(),
      attempt: attempt.snapshot(),
    });
    const restored = readPublicationDraft(scope)!;
    expect(restored.values).toEqual(payload);
    expect(new PublicationAttempt(restored.attempt).key(payload)).toBe(key);
    clearPublicationDraft(scope);
    expect(readPublicationDraft(scope)).toBeUndefined();
  });
  it("草稿不能跨用户、企业或品牌恢复", () => {
    writePublicationDraft(scope, {
      values: { title: "企业私有稿件" },
      bodyFormat: "text",
      updatedAt: Date.now(),
    });
    for (const changed of [
      { userId: "other" },
      { organizationId: "other" },
      { brandId: "other" },
    ]) {
      expect(readPublicationDraft({ ...scope, ...changed })).toBeUndefined();
    }
  });
  it("过期和损坏草稿不会阻止页面继续使用", () => {
    writePublicationDraft(scope, {
      values: {},
      bodyFormat: "text",
      updatedAt: Date.now() - 86_400_001,
    });
    expect(readPublicationDraft(scope)).toBeUndefined();
    expect(storage.size).toBe(0);
    storage.set("geo.publication.user.enterprise.brand", "invalid JSON");
    expect(readPublicationDraft(scope)).toBeUndefined();
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("Storage denied");
      },
      setItem: () => {
        throw new Error("Storage denied");
      },
      removeItem: () => {
        throw new Error("Storage denied");
      },
    });
    expect(readPublicationDraft(scope)).toBeUndefined();
    expect(
      writePublicationDraft(scope, {
        values: {},
        bodyFormat: "text",
        updatedAt: Date.now(),
      }),
    ).toBe(false);
    expect(() => clearPublicationDraft(scope)).not.toThrow();
  });
  it("普通正文自动分段并转义，HTML 模式保留主动输入的格式", () => {
    expect(
      publicationBodyHtml("品牌 <优势> & 数据\n下一行\n\n第二段", "text"),
    ).toBe("<p>品牌 &lt;优势&gt; &amp; 数据<br />下一行</p>\n<p>第二段</p>");
    expect(publicationBodyHtml("<p>文章</p>", "html")).toBe("<p>文章</p>");
    expect(publicationBodyHtml("   ", "text")).toBeUndefined();
  });
});
