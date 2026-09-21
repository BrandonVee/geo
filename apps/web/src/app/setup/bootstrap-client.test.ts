import { afterEach, describe, expect, it, vi } from "vitest";
import { isBootstrapComplete, submitBootstrap } from "./bootstrap-client";

const values = {
  name: "测试管理员",
  username: "test_admin",
  password: "TestOnly1234567",
};
afterEach(() => vi.unstubAllGlobals());

describe("bootstrap navigation recovery", () => {
  it("accepts committed creation even if its response body is unreadable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 201 })),
    );
    expect(await submitBootstrap(values)).toEqual({ complete: true });
  });
  it("routes an already initialized conflict to login", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: "SYSTEM_ALREADY_INITIALIZED" } },
            { status: 409 },
          ),
        ),
    );
    expect(await submitBootstrap(values)).toEqual({ complete: true });
  });
  it("does not treat another conflict as success", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: "USERNAME_EXISTS", message: "该账号已存在" } },
            { status: 409 },
          ),
        ),
    );
    expect(await submitBootstrap(values)).toEqual({
      complete: false,
      message: "该账号已存在",
    });
  });
  it("reconciles a dropped response after commit", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError("network"))
        .mockResolvedValueOnce(Response.json({ data: { initialized: true } })),
    );
    expect(await submitBootstrap(values)).toEqual({ complete: true });
  });
  it("keeps the form if creation and status confirmation fail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
    expect((await submitBootstrap(values)).complete).toBe(false);
  });
  it("reconciles server errors without repeating the creation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("error", { status: 500 }))
      .mockResolvedValueOnce(Response.json({ data: { initialized: true } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await submitBootstrap(values)).toEqual({ complete: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ cache: "no-store" });
  });
  it("requires a true initialized state", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ data: { initialized: false } })),
    );
    expect(await isBootstrapComplete()).toBe(false);
  });
});
