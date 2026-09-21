import { describe, expect, it } from "vitest";
import { projectCapacity } from "./capacity";

describe("projectCapacity", () => {
  it("shows current usage and projected capacity after expansion", () => {
    expect(projectCapacity({ total_amount: 10, used_amount: 6 }, 3)).toEqual({
      currentLimit: 10,
      createdCount: 6,
      availableCount: 4,
      projectedLimit: 13,
      projectedAvailableCount: 7,
      utilization: 60,
    });
  });

  it("does not expose a negative available count when usage exceeds quota", () => {
    expect(projectCapacity({ total_amount: 2, used_amount: 3 }, 1)).toEqual({
      currentLimit: 2,
      createdCount: 3,
      availableCount: 0,
      projectedLimit: 3,
      projectedAvailableCount: 1,
      utilization: 100,
    });
  });
});
