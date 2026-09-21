import { describe, expect, it } from "vitest";
import { findModelUpstreamLabel, resolveModelDisplay } from "./model-display";

describe("resolveModelDisplay", () => {
  it.each([
    ["kimi", undefined],
    ["kimi-search", undefined],
    ["unknown", "Kimi 智能助手"],
    ["moonshot_ai", undefined],
  ])("maps Kimi alias %s", (modelId, upstreamLabel) => {
    expect(resolveModelDisplay(modelId, upstreamLabel)).toMatchObject({
      iconSrc: "/model-icons/kimi-color.svg",
      name: "Kimi 智能助手",
    });
  });

  it.each([
    ["qianwen", undefined],
    ["QIANWEN", undefined],
    ["qianwen-ai", undefined],
    ["aliyun_qianwen", undefined],
    ["unknown", "阿里千问"],
  ])("maps Qianwen alias %s", (modelId, upstreamLabel) => {
    expect(resolveModelDisplay(modelId, upstreamLabel)).toMatchObject({
      iconSrc: "/model-icons/qwen-color.svg",
      name: "通义千问",
    });
  });

  it("finds upstream labels without depending on identifier casing", () => {
    expect(findModelUpstreamLabel({ QIANWEN: "qianwen" }, "QIANWEN")).toBe(
      "QIANWEN",
    );
  });
});
