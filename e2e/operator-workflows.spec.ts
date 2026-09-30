import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

const webRequire = createRequire(
  resolve(process.cwd(), "apps/web/package.json"),
);
let database: typeof import("../packages/db/src/index");
let operators: typeof import("../apps/web/node_modules/drizzle-orm");
let fixture: {
  userId: string;
  username: string;
  password: string;
  scopes: {
    organizationId: string;
    teamBindingId: string;
    brandId: string;
    name: string;
  }[];
};
const channel = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "测试媒体",
  category: "科技",
  priceAmount: 100,
  currency: "CNY",
  provider: "frog_media",
  providerMediaType: "website",
  remarks: "正常投稿",
  caseLink: null,
};
const alternate = {
  ...channel,
  id: "22222222-2222-4222-8222-222222222222",
  name: "另一媒体",
};
const envelope = (data: unknown) => ({ data, requestId: "workflow-e2e" });
const fulfill = (route: Route, data: unknown) =>
  route.fulfill({ json: envelope(data) });

async function mockBusinessApis(
  page: Page,
  onPost?: (route: Route) => Promise<void>,
) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (route.request().method() === "POST" && onPost) return onPost(route);
    if (
      path === "/api/v1/answerbit/brands" ||
      path === "/api/v1/point-usage" ||
      path === "/api/v1/balances"
    )
      return route.continue();
    if (path.startsWith("/api/v1/publication-channels/"))
      return fulfill(route, path.endsWith(alternate.id) ? alternate : channel);
    if (path === "/api/v1/publication-channels")
      return fulfill(route, {
        list: [channel, alternate],
        pagination: { page: 1, pageSize: 20, total: 2, pages: 1 },
      });
    if (path === "/api/v1/answerbit/article-templates")
      return fulfill(route, [
        {
          template_id: 1,
          template_name: "普通文章模板",
          description: "围绕问题生成",
          is_high_ref: 0,
        },
      ]);
    if (path === "/api/v1/answerbit/prompts")
      return fulfill(route, {
        titles: [
          {
            prompts: [
              {
                id: "prompt-1",
                query_str: "如何选择品牌？",
                title_name: "产品",
              },
            ],
          },
        ],
      });
    if (path === "/api/v1/answerbit/article-jobs") return fulfill(route, []);
    if (path === "/api/v1/content-documents")
      return fulfill(route, { list: [], total: 0 });
    if (path === "/api/v1/content-folders" || path === "/api/v1/answerbit/tags")
      return fulfill(route, []);
    // Unexpected Tencent reads fail locally; no real upstream calls occur in QA.
    return route.fulfill({
      status: 503,
      json: {
        error: { code: "QA_UNAVAILABLE", message: "模拟上游暂时不可用" },
      },
    });
  });
}
const scopedPath = (path: string, index = 0) =>
  `${path}?${new URLSearchParams({ organizationId: fixture.scopes[index].organizationId, brandId: fixture.scopes[index].brandId })}`;

test.describe("真实运营操作闭环", () => {
  test.skip(
    process.env.WORKFLOW_E2E !== "1",
    "需本机已迁移数据库、Redis 与已接入的开发服务",
  );
  test.beforeAll(async () => {
    database = await import("../packages/db/src/index");
    operators = await import(webRequire.resolve("drizzle-orm"));
  });
  test.beforeEach(async ({ page }) => {
    const {
      db,
      users,
      accounts,
      organizations,
      organizationMembers,
      brandAccess,
      answerbitConnections,
      answerbitTeamBindings,
      answerbitBrandMappings,
      balanceAccounts,
      platformAnswerbitCredentials,
    } = database;
    const { hashPassword } = await import(
      webRequire.resolve("better-auth/crypto")
    );
    const suffix = randomUUID().slice(0, 8);
    fixture = {
      userId: randomUUID(),
      username: `flow_${suffix}`,
      password: `FlowTest_${randomUUID()}`,
      scopes: [],
    };
    await db.insert(users).values({
      id: fixture.userId,
      name: "操作流程测试",
      username: fixture.username,
      email: `${suffix}@workflow.invalid`,
    });
    await db.insert(accounts).values({
      userId: fixture.userId,
      providerId: "credential",
      accountId: fixture.userId,
      password: await hashPassword(fixture.password),
    });
    const [configuration] = await db
      .select({ teamId: platformAnswerbitCredentials.teamId })
      .from(platformAnswerbitCredentials);
    for (const letter of ["A", "B"]) {
      const organizationId = randomUUID(),
        teamBindingId = randomUUID(),
        brandId = `qa-${randomUUID()}`,
        name = `流程测试企业 ${letter}`;
      await db
        .insert(organizations)
        .values({ id: organizationId, name, slug: organizationId });
      await db
        .insert(organizationMembers)
        .values({ organizationId, userId: fixture.userId, status: "active" });
      const [connection] = await db
        .insert(answerbitConnections)
        .values({
          organizationId,
          encryptedApiKey: "platform-managed",
          apiKeyFingerprint: randomUUID(),
          apiKeyHint: "qa",
          createdBy: fixture.userId,
          managedByPlatform: true,
        })
        .returning();
      await db.insert(answerbitTeamBindings).values({
        id: teamBindingId,
        organizationId,
        connectionId: connection.id,
        teamId: configuration.teamId!,
        status: "active",
      });
      await db
        .insert(answerbitBrandMappings)
        .values({ organizationId, teamBindingId, brandId, brandName: name });
      await db.insert(brandAccess).values({
        organizationId,
        teamBindingId,
        brandId,
        userId: fixture.userId,
        role: "brand_admin",
      });
      await db.insert(balanceAccounts).values([
        { organizationId, brandId, asset: "publication_cny", balance: 10000 },
        { organizationId, brandId, asset: "answerbit_points", balance: 1000 },
      ]);
      fixture.scopes.push({ organizationId, teamBindingId, brandId, name });
    }
    const login = await page.request.post("/api/auth/sign-in/username", {
      headers: { Origin: process.env.APP_URL ?? "http://localhost:3000" },
      data: { username: fixture.username, password: fixture.password },
    });
    expect(login.ok()).toBeTruthy();
  });
  test.afterEach(async ({ page }) => {
    await page.request.post("/api/auth/sign-out", {
      headers: { Origin: process.env.APP_URL ?? "http://localhost:3000" },
      data: {},
    });
    const {
      db,
      balanceAccounts,
      brandAccess,
      answerbitBrandMappings,
      answerbitTeamBindings,
      answerbitConnections,
      organizationMembers,
      organizations,
      users,
    } = database;
    const { eq, inArray } = operators;
    const ids = fixture.scopes.map((scope) => scope.organizationId);
    await db
      .delete(balanceAccounts)
      .where(inArray(balanceAccounts.organizationId, ids));
    await db.delete(brandAccess).where(eq(brandAccess.userId, fixture.userId));
    await db
      .delete(answerbitBrandMappings)
      .where(inArray(answerbitBrandMappings.organizationId, ids));
    await db
      .delete(answerbitTeamBindings)
      .where(inArray(answerbitTeamBindings.organizationId, ids));
    await db
      .delete(answerbitConnections)
      .where(inArray(answerbitConnections.organizationId, ids));
    await db
      .delete(organizationMembers)
      .where(eq(organizationMembers.userId, fixture.userId));
    await db.delete(organizations).where(inArray(organizations.id, ids));
    await db.delete(users).where(eq(users.id, fixture.userId));
  });
  test.afterAll(async () => {
    await database?.pool.end();
  });

  test("投稿草稿跨渠道往返和刷新恢复，企业切换隔离，普通正文自动排版", async ({
    page,
  }) => {
    let submitted: Record<string, unknown> | undefined;
    await mockBusinessApis(page, async (route) => {
      submitted = route.request().postDataJSON();
      await fulfill(route, {
        order: { id: randomUUID(), status: "processing" },
        replayed: false,
      });
    });
    await page.goto(scopedPath("/dashboard/publication/new"));
    await expect(
      page.getByPlaceholder("请输入本次发布的内容标题"),
    ).toBeEnabled();
    await page
      .getByPlaceholder("请输入本次发布的内容标题")
      .fill("企业 A 的品牌文章");
    await page
      .getByPlaceholder("粘贴或输入文章正文，段落将自动排版")
      .fill("第一段 <品牌>\n\n第二段");
    await page
      .getByPlaceholder("可填写频道、来源、署名、图片处理等补充要求")
      .fill("保留图片");
    await page.getByRole("link", { name: "进入渠道库精细筛选" }).click();
    await page
      .getByRole("link", { name: "选择并填写发布内容" })
      .first()
      .click();
    await expect(page.getByPlaceholder("请输入本次发布的内容标题")).toHaveValue(
      "企业 A 的品牌文章",
    );
    await expect(
      page.getByPlaceholder("粘贴或输入文章正文，段落将自动排版"),
    ).toHaveValue("第一段 <品牌>\n\n第二段");
    await page.reload();
    await expect(
      page.getByPlaceholder("可填写频道、来源、署名、图片处理等补充要求"),
    ).toHaveValue("保留图片");
    await page.goto(scopedPath("/dashboard/publication/new", 1));
    await expect(page.getByPlaceholder("请输入本次发布的内容标题")).toHaveValue(
      "",
    );
    await page.goto(scopedPath("/dashboard/publication/new"));
    await expect(page.getByPlaceholder("请输入本次发布的内容标题")).toHaveValue(
      "企业 A 的品牌文章",
    );
    await page.getByRole("button", { name: "确认并提交发布" }).click();
    await expect(page.getByRole("button", { name: "查看订单" })).toBeVisible();
    expect(submitted).toMatchObject({
      organizationId: fixture.scopes[0].organizationId,
      brandId: fixture.scopes[0].brandId,
      contentHtml: "<p>第一段 &lt;品牌&gt;</p>\n<p>第二段</p>",
      note: "保留图片",
    });
    await page.reload();
    await expect(page.getByPlaceholder("请输入本次发布的内容标题")).toHaveValue(
      "",
    );
  });

  test("文章生成不依赖效果追踪接口，网络失败重试复用同一任务键", async ({
    page,
  }) => {
    const keys: string[] = [];
    await mockBusinessApis(page, async (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      if (keys.length === 1) return route.abort("failed");
      return fulfill(route, {
        id: randomUUID(),
        status: "queued",
        replayed: true,
      });
    });
    await page.goto(
      `${scopedPath("/dashboard/content")}&stage=generate&promptId=prompt-1&promptText=${encodeURIComponent("如何选择品牌？")}`,
    );
    await expect(
      page.getByText("如何选择品牌？ · 产品", { exact: true }),
    ).toBeVisible();
    const generate = page.getByRole("button", { name: /提交.*文章生成/ });
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect(
      page.getByText("已返回相同幂等任务", { exact: true }),
    ).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  test("品牌查看者能看积分统计，未授权模块与写入口不出现", async ({ page }) => {
    const { db, brandAccess, organizationUserFeatureScopes } = database;
    await db
      .update(brandAccess)
      .set({ role: "brand_viewer" })
      .where(operators.eq(brandAccess.userId, fixture.userId));
    await db.insert(organizationUserFeatureScopes).values(
      fixture.scopes.map((scope) => ({
        organizationId: scope.organizationId,
        userId: fixture.userId,
        features: ["balance" as const],
      })),
    );
    await page.goto(scopedPath("/dashboard/metering"));
    await expect(
      page.getByText("当前品牌可用积分", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".ant-statistic-content").first()).toContainText(
      "1,000",
    );
    await expect(page.getByText("企业可分配积分", { exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole("menuitem", { name: "提交发布" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("menuitem", { name: "AI 内容生成" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "进入平台管理" }),
    ).toHaveCount(0);
    const result = await page.request.get(
      `/api/v1/point-usage?${new URLSearchParams({ organizationId: fixture.scopes[0].organizationId, teamBindingId: fixture.scopes[0].teamBindingId, brandId: fixture.scopes[0].brandId, beginDate: "2026-01-01", endDate: "2026-10-01" })}`,
    );
    expect(result.ok()).toBeTruthy();
    expect((await result.json()).data).toMatchObject({
      balance: 1000,
      organizationBalance: null,
    });
  });
});
