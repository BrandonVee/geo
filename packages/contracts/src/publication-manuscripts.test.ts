import { describe, expect, it } from "vitest";
import {
  createPublicationOrderSchema,
  publicationManuscriptQuerySchema,
  publicationManuscriptSchema,
} from "./index";

const organizationId = "e17c707b-f07c-4464-a4fa-26d699dad45b";
const teamBindingId = "630dacb0-54b4-464c-acd0-de1079ff2a0b";
const orderId = "d5ddb2bc-44ad-4395-a05b-e3a2ad0129f8";
const scope = { organizationId, teamBindingId, brandId: "brand-1" };
const input = {
  ...scope,
  channelId: orderId,
  title: "原稿标题",
  idempotencyKey: "publication-manuscript-1",
};

describe("投稿原稿契约", () => {
  it.each([
    { contentHtml: "<p>正文</p>" },
    { contentUrl: "https://example.test/original" },
    { sourceDocumentId: orderId },
    { sourceJobId: orderId },
  ])("支持独立稿件来源 %#", (source) => {
    expect(
      createPublicationOrderSchema.safeParse({ ...input, ...source }).success,
    ).toBe(true);
  });
  it.each([
    { contentUrl: "javascript:alert(1)" },
    { contentUrl: "data:text/html,bad" },
    { contentUrl: "not-a-url" },
    { contentUrl: "https://example.test/" + "x".repeat(2000) },
    { contentHtml: "x".repeat(500001) },
    { contentHtml: " " },
    { sourceJobId: orderId, sourceDocumentId: orderId },
    { sourceJobId: orderId, contentHtml: "<p>正文</p>" },
    { sourceDocumentId: orderId, contentHtml: "<p>正文</p>" },
    { note: "x".repeat(2001) },
  ])("拒绝非法或含糊的投稿 %#", (source) => {
    expect(
      createPublicationOrderSchema.safeParse({ ...input, ...source }).success,
    ).toBe(false);
  });
  it("单笔原稿要求完整范围，拒绝不支持的查询参数", () => {
    expect(publicationManuscriptQuerySchema.parse(scope)).toEqual(scope);
    expect(
      publicationManuscriptQuerySchema.safeParse({
        organizationId,
        brandId: "brand-1",
      }).success,
    ).toBe(false);
    expect(
      publicationManuscriptQuerySchema.safeParse({
        ...scope,
        contentHtml: "unexpected",
      }).success,
    ).toBe(false);
  });
  it("历史缺失允许未知来源、空正文和空原备注，不编造源版本", () => {
    expect(
      publicationManuscriptSchema.safeParse({
        orderId,
        title: "历史订单",
        submittedAt: "2026-10-02T00:00:00.000Z",
        snapshotStatus: "legacy_unavailable",
        source: { kind: "unknown" },
        contentHtml: null,
        contentUrl: null,
        submissionNote: null,
      }).success,
    ).toBe(true);
  });
});
