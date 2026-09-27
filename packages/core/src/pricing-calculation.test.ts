import { describe, expect, it } from "vitest";
import { calculateMarkedUpPoints } from "./pricing-calculation";

describe("积分加价计费", () => {
  it("按基价加百分比并向上取整", () => {
    expect(calculateMarkedUpPoints(100, 3000)).toBe(130);
    expect(calculateMarkedUpPoints(100, 1000)).toBe(110);
    expect(calculateMarkedUpPoints(25, 1500)).toBe(29);
    expect(calculateMarkedUpPoints(1, 1000)).toBe(2);
  });

  it("零加价保持基价，零基价不收费", () => {
    expect(calculateMarkedUpPoints(25, 0)).toBe(25);
    expect(calculateMarkedUpPoints(0, 3000)).toBe(0);
  });

  it("负加价率保留原折扣", () => {
    expect(calculateMarkedUpPoints(100, -1000)).toBe(90);
    expect(calculateMarkedUpPoints(10, -3000)).toBe(7);
    expect(calculateMarkedUpPoints(100, -10_000)).toBe(0);
  });
});
