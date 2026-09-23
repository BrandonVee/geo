import { describe, expect, it } from "vitest";
import { isHttpOrigin } from "./http-origin";

describe("isHttpOrigin", () => {
  it.each([
    "https://api.example.com",
    "https://api.example.com/",
    "http://127.0.0.1:8080",
    "http://[::1]:3000",
  ])("accepts HTTP(S) origin %s", (value) => {
    expect(isHttpOrigin(value)).toBe(true);
  });

  it.each([
    "ftp://api.example.com",
    "https:api.example.com",
    "https://api.example.com/v1",
    "https://api.example.com/.",
    "https://api.example.com/v1/..",
    "https://api.example.com?tenant=1",
    "https://api.example.com#fragment",
    "https://user:password@api.example.com",
    " https://api.example.com",
    "not-a-url",
  ])("rejects non-origin value %s", (value) => {
    expect(isHttpOrigin(value)).toBe(false);
  });
});
