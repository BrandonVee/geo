import { describe, expect, it } from "vitest";
import { getUserAccessState, hasActiveUserAccess } from "./user-access";

const now = new Date("2026-09-13T10:00:00.000Z").getTime();

describe("用户访问有效期", () => {
  it("普通客户不受代理商有效期影响", () => {
    expect(
      getUserAccessState(
        {
          status: "active",
          accountType: "customer",
          agentExpiresAt: "2020-01-01T00:00:00.000Z",
        },
        now,
      ),
    ).toBe("active");
  });

  it("区分尚未生效和已经到期的代理商", () => {
    expect(
      getUserAccessState(
        {
          status: "active",
          accountType: "agent",
          agentValidFrom: "2026-09-14T00:00:00.000Z",
        },
        now,
      ),
    ).toBe("scheduled");
    expect(
      getUserAccessState(
        {
          status: "active",
          accountType: "agent",
          agentExpiresAt: "2026-09-13T09:00:00.000Z",
        },
        now,
      ),
    ).toBe("expired");
  });

  it("允许处于有效区间或长期有效的代理商访问", () => {
    expect(
      hasActiveUserAccess(
        {
          status: "active",
          accountType: "agent",
          agentValidFrom: "2026-09-01T00:00:00.000Z",
          agentExpiresAt: "2026-10-01T00:00:00.000Z",
        },
        now,
      ),
    ).toBe(true);
    expect(
      hasActiveUserAccess({ status: "active", accountType: "agent" }, now),
    ).toBe(true);
  });

  it("停用状态优先于代理商有效期", () => {
    expect(
      getUserAccessState({ status: "disabled", accountType: "agent" }, now),
    ).toBe("disabled");
  });
});
