import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { eq, inArray } from "drizzle-orm";
import { accounts, db, sessions, users } from "@geo/db";
import { adminRepository } from "@/server/repositories/admin";

describe.skipIf(process.env.AUTH_SESSION_DB_TESTS !== "1")(
  "认证会话 PostgreSQL / Redis 回归",
  () => {
    let auth: typeof import("./auth").auth;
    let requireUser: typeof import("./session").requireUser;
    let redis: Awaited<
      ReturnType<typeof import("@/server/redis").getRedisClient>
    >;
    let rateLimit: typeof import("@/server/redis").redisRateLimitStorage;
    let passwordHash: string;
    const createdUsers: string[] = [];
    const cacheKeys: string[] = [];
    const password = "SessionRegression2026!";
    const origin = () => process.env.BETTER_AUTH_URL!;

    beforeAll(async () => {
      if (
        process.env.WORKFLOW_DISPOSABLE_DB !== "1" ||
        !/^\/geo_workflow_qa_[a-f0-9]+$/.test(
          new URL(process.env.DATABASE_URL!).pathname,
        )
      )
        throw new Error("Disposable QA database required");
      ({ auth } = await import("./auth"));
      ({ requireUser } = await import("./session"));
      const storage = await import("@/server/redis");
      redis = await storage.getRedisClient();
      rateLimit = storage.redisRateLimitStorage;
      passwordHash = await hashPassword(password);
    });

    afterAll(async () => {
      if (redis && cacheKeys.length) await redis.del(cacheKeys);
      if (createdUsers.length)
        await db.delete(users).where(inArray(users.id, createdUsers));
    });

    async function fixture(accountType: "customer" | "agent" = "customer") {
      const id = randomUUID();
      const username = `qa_${id.replaceAll("-", "").slice(0, 24)}`;
      await db.insert(users).values({
        id,
        username,
        name: "Session QA",
        email: `${id}@test.invalid`,
        accountType,
      });
      createdUsers.push(id);
      await db.insert(accounts).values({
        userId: id,
        accountId: id,
        providerId: "credential",
        password: passwordHash,
      });
      const response = await auth.api.signInUsername({
        body: { username, password },
        headers: new Headers({ origin: origin() }),
        asResponse: true,
      });
      expect(response.status).toBe(200);
      const cookie = response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      expect(cookie).toContain("session_token=");
      const headers = new Headers({ cookie });
      const signedIn = await auth.api.getSession({ headers });
      expect(signedIn?.user.id).toBe(id);
      // Reproduce a still-live pre-upgrade secondary-storage entry. Revoking
      // the database session must win even while this cached copy exists.
      const cacheKey = `answerbit-geo:auth:${signedIn!.session.token}`;
      cacheKeys.push(cacheKey);
      await redis.set(cacheKey, JSON.stringify(signedIn), { EX: 300 });
      return { id, headers, cacheKey, signedIn: signedIn! };
    }

    const readUser = (headers: Headers) =>
      requireUser(new Request(`${origin()}/api/v1/me`, { headers }), {
        allowBeforeTencentConnection: true,
      });

    it("数据库撤销优先于仍存活的 Redis 会话，API 和页面会话读取均拒绝旧 Cookie", async () => {
      const user = await fixture();
      await db.delete(sessions).where(eq(sessions.userId, user.id));

      expect(await redis.exists(user.cacheKey)).toBe(1);
      expect(await auth.api.getSession({ headers: user.headers })).toBeNull();
      const response = await auth.handler(
        new Request(`${origin()}/api/auth/get-session`, {
          headers: user.headers,
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toBeNull();
      await expect(readUser(user.headers)).rejects.toMatchObject({
        status: 401,
        code: "AUTH_REQUIRED",
      });
    });

    it("管理员停用后立即失效，恢复账号不会复活被撤销的会话", async () => {
      const user = await fixture();
      await adminRepository.updateUser(user.id, { status: "disabled" });
      expect(await auth.api.getSession({ headers: user.headers })).toBeNull();
      await expect(readUser(user.headers)).rejects.toMatchObject({
        code: "AUTH_REQUIRED",
      });
      await adminRepository.updateUser(user.id, { status: "active" });
      expect(await redis.exists(user.cacheKey)).toBe(1);
      expect(await auth.api.getSession({ headers: user.headers })).toBeNull();
    });

    it("账户类型变更撤销原会话，即使旧缓存仍为有效客户", async () => {
      const user = await fixture();
      await adminRepository.updateUser(user.id, { accountType: "agent" });
      expect(await auth.api.getSession({ headers: user.headers })).toBeNull();
      await expect(readUser(user.headers)).rejects.toMatchObject({
        code: "AUTH_REQUIRED",
      });
    });

    it("代理商有效期和资料每次读取数据库当前值，续期后原有效会话可继续使用", async () => {
      const user = await fixture("agent");
      const future = new Date(Date.now() + 86_400_000);
      const past = new Date(Date.now() - 86_400_000);
      await adminRepository.updateUser(user.id, { agentValidFrom: future });
      await expect(readUser(user.headers)).rejects.toMatchObject({
        status: 403,
        code: "AGENT_NOT_YET_VALID",
      });
      await adminRepository.updateUser(user.id, {
        agentValidFrom: null,
        agentExpiresAt: past,
      });
      await expect(readUser(user.headers)).rejects.toMatchObject({
        status: 403,
        code: "AGENT_EXPIRED",
      });
      await adminRepository.updateUser(user.id, {
        agentExpiresAt: future,
        name: "Renewed Session QA",
        pricingTier: "gold",
      });
      await expect(readUser(user.headers)).resolves.toMatchObject({
        id: user.id,
        name: "Renewed Session QA",
        pricingTier: "gold",
      });
      expect(await redis.exists(user.cacheKey)).toBe(1);
    });

    it("数据库过期会话不会被 Redis 中较晚的有效期恢复", async () => {
      const user = await fixture();
      await db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(sessions.userId, user.id));
      expect(await auth.api.getSession({ headers: user.headers })).toBeNull();
    });

    it("移除会话缓存后，Redis 并发登录限流仍只允许配置次数", async () => {
      const key = `session-qa-rate:${randomUUID()}`;
      const cacheKey = `answerbit-geo:auth:${key}`;
      cacheKeys.push(cacheKey);
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          rateLimit.consume(key, { window: 60, max: 8 }),
        ),
      );
      expect(results.filter((result) => result.allowed)).toHaveLength(8);
      expect(results.filter((result) => !result.allowed)).toHaveLength(12);
      expect(
        results
          .filter((result) => !result.allowed)
          .every((result) => Number.isFinite(result.retryAfter)),
      ).toBe(true);
      expect(await redis.ttl(cacheKey)).toBeGreaterThan(0);
    });
  },
);
