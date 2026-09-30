import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readDocumentDrafts,
  removeDocumentDraft,
  saveDocumentDraft,
  type DocumentDraft,
} from "./document-draft";

const storage = new Map<string, string>();
const scope = {
  userId: "user",
  organizationId: "org",
  teamBindingId: "team",
  brandId: "brand",
};
const draft: DocumentDraft = {
  documentId: "11111111-1111-4111-8111-111111111111",
  expectedVersion: 1,
  updatedAt: 1000,
  values: {
    title: "编辑稿",
    body: "未保存正文",
    status: "draft",
    source: "manual",
    language: "zh-CN",
    tags: [],
  },
};
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("sessionStorage", {
    get length() {
      return storage.size;
    },
    key: (index: number) => [...storage.keys()][index] ?? null,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("文档未保存编辑", () => {
  it("保存的迟到确认不会清掉用户之后写入的暂存", () => {
    saveDocumentDraft(scope, draft);
    const submitted = readDocumentDrafts(scope, 1000)[0];
    const newer = {
      ...draft,
      updatedAt: 2000,
      values: { ...draft.values, body: "继续编辑的正文" },
    };
    saveDocumentDraft(scope, newer);
    removeDocumentDraft(scope, submitted, submitted);
    expect(readDocumentDrafts(scope, 2000)).toEqual([newer]);
    removeDocumentDraft(scope, newer, newer);
    expect(readDocumentDrafts(scope, 2000)).toEqual([]);
  });
  it("按用户、企业、绑定、品牌隔离；多个文档与新建稿互不覆盖", () => {
    saveDocumentDraft(scope, draft);
    const newDraft = {
      ...draft,
      documentId: undefined,
      expectedVersion: undefined,
      updatedAt: 2000,
    };
    saveDocumentDraft(scope, newDraft);
    expect(readDocumentDrafts(scope, 2000)).toEqual([newDraft, draft]);
    for (const field of Object.keys(scope))
      expect(readDocumentDrafts({ ...scope, [field]: "other" }, 2000)).toEqual(
        [],
      );
    removeDocumentDraft(scope, draft);
    expect(readDocumentDrafts(scope, 2000)).toEqual([newDraft]);
  });
  it("24 小时后清理过期稿，保留其他范围的编辑", () => {
    saveDocumentDraft(scope, draft);
    saveDocumentDraft({ ...scope, brandId: "brand.extra" }, draft);
    expect(readDocumentDrafts(scope, 1001 + 86400000)).toEqual([]);
    expect(storage.size).toBe(1);
  });
  it("损坏或不匹配的存储不会应用为文档正文", () => {
    saveDocumentDraft(scope, draft);
    const key = [...storage.keys()][0];
    storage.set(key, "bad JSON");
    expect(readDocumentDrafts(scope, 2000)).toEqual([]);
    saveDocumentDraft(scope, { ...draft, expectedVersion: undefined });
    expect(readDocumentDrafts(scope, 2000)).toEqual([]);
  });
  it("暂时超出提交校验的标题和标签也保留，恢复后由表单校验", () => {
    const invalidForm = {
      ...draft,
      values: {
        ...draft.values,
        title: "长".repeat(501),
        tags: ["标".repeat(41)],
      },
    };
    saveDocumentDraft(scope, invalidForm);
    expect(readDocumentDrafts(scope, 2000)).toEqual([invalidForm]);
  });
  it("存储被禁用或空间不足时返回失败，不阻止继续编辑", () => {
    vi.stubGlobal("sessionStorage", {
      get length() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("quota");
      },
      removeItem() {
        throw new Error("denied");
      },
    });
    expect(saveDocumentDraft(scope, draft)).toBe(false);
    expect(readDocumentDrafts(scope)).toEqual([]);
    expect(() => removeDocumentDraft(scope, draft)).not.toThrow();
  });
});
