import { describe, expect, it } from "vitest";
import { cacheTtlMs, canonicalJson, normalizeCachePayload } from "./read-cache";

describe("AnswerBit read cache key normalization", () => {
  it("ignores object field order but retains array order and all filter fields", () => {
    expect(canonicalJson({ brand_id: "b", platforms: ["a", "c"] })).toBe(
      canonicalJson({ platforms: ["a", "c"], brand_id: "b" }),
    );
    expect(canonicalJson({ platforms: ["a", "c"] })).not.toBe(
      canonicalJson({ platforms: ["c", "a"] }),
    );
    expect(canonicalJson({ brand_id: "b" })).not.toBe(
      canonicalJson({ brand_id: "c" }),
    );
  });

  it("normalizes unordered filter sets without changing ordered arrays", () => {
    expect(
      canonicalJson(normalizeCachePayload({ platforms: ["c", "a"] })),
    ).toBe(canonicalJson(normalizeCachePayload({ platforms: ["a", "c"] })));
    expect(
      canonicalJson(normalizeCachePayload({ values: ["c", "a"] })),
    ).not.toBe(canonicalJson(normalizeCachePayload({ values: ["a", "c"] })));
  });

  it("uses a shorter lifetime for live date ranges", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(cacheTtlMs({ end_date: today })).toBe(60 * 60_000);
    expect(cacheTtlMs({ end_date: "2020-01-01" })).toBe(24 * 60 * 60_000);
    expect(cacheTtlMs({ teamId: "team" })).toBe(24 * 60 * 60_000);
  });
});
