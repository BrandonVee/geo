import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import axe from "axe-core";

const webRequire = createRequire(
  resolve(process.cwd(), "apps/web/package.json"),
);
let database: typeof import("../packages/db/src/index");
let operators: typeof import("../apps/web/node_modules/drizzle-orm");
let fixture: {
  publicationChannelIds?: string[];
  extraUserIds?: string[];
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
      path === "/api/v1/publication-orders" ||
      path.endsWith("/tracking-source") ||
      path === "/api/v1/answerbit/brands" ||
      path === "/api/v1/point-usage" ||
      path === "/api/v1/balances" ||
      path.startsWith("/api/v1/saved-views")
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
    if (
      path === "/api/v1/answerbit/article-jobs" ||
      path === "/api/v1/answerbit/article-tracking-submissions"
    )
      return fulfill(route, []);
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
async function mockMonitoringApis(
  page: Page,
  handler?: (route: Route, path: string, index: number) => Promise<boolean>,
) {
  await mockBusinessApis(page);
  await page.route("**/api/v1/answerbit/**", async (route) => {
    const url = new URL(route.request().url());
    const body =
      route.request().method() !== "GET" && route.request().postData()
        ? route.request().postDataJSON()
        : {};
    const index = fixture.scopes.findIndex(
      (scope) =>
        scope.organizationId ===
        (url.searchParams.get("organizationId") ?? body.organizationId),
    );
    if (handler && (await handler(route, url.pathname, index))) return;
    if (route.request().method() !== "GET") return route.fallback();
    if (url.pathname.endsWith("/dashboard/platforms"))
      return fulfill(route, { DeepSeek: "deepseek" });
    if (url.pathname === "/api/v1/answerbit/categories")
      return fulfill(route, [
        {
          id: `category-${index}`,
          title_name: "产品选择",
          title_desc: "了解产品",
          count: 1,
        },
      ]);
    if (url.pathname === "/api/v1/answerbit/prompts")
      return fulfill(route, {
        total_prompts: 1,
        titles: [
          {
            title_id: `category-${index}`,
            title_name: "产品选择",
            title_desc: "了解产品",
            prompt_count: 1,
            exposure: 12.5,
            avg_rank: 2,
            fluctuation: 0,
            prompts: [
              {
                id: `prompt-${index}`,
                query_str: `${fixture.scopes[index].name} 的监测问题`,
                status: 1,
                title_id: `category-${index}`,
                tags: [],
                exposure: 12.5,
                avg_rank: 2,
                fluctuation: 0,
              },
            ],
          },
        ],
      });
    return route.fallback();
  });
}

async function mockOverviewApis(
  page: Page,
  handler?: (route: Route, path: string, index: number) => Promise<boolean>,
) {
  await mockBusinessApis(page);
  await page.route("**/api/v1/answerbit/**", async (route) => {
    const url = new URL(route.request().url());
    const body =
      route.request().method() !== "GET" && route.request().postData()
        ? route.request().postDataJSON()
        : {};
    const index = fixture.scopes.findIndex(
      (scope) =>
        scope.organizationId ===
        (url.searchParams.get("organizationId") ?? body.organizationId),
    );
    if (handler && (await handler(route, url.pathname, index))) return;
    if (route.request().method() !== "GET") return route.fallback();
    if (url.pathname === "/api/v1/answerbit/competitors")
      return fulfill(route, [
        {
          id: `competitor-${index}`,
          name: `${fixture.scopes[index].name} 的竞品`,
          alias: "原别名",
        },
      ]);
    if (url.pathname.endsWith("/dashboard/platforms"))
      return fulfill(route, { DeepSeek: "deepseek" });
    if (url.pathname === "/api/v1/answerbit/dashboard")
      return fulfill(route, {
        exposure: { value: index ? 55 : 22.5, fluctuation: 0 },
        avg_rank: { value: 2, fluctuation: 0 },
        score: { value: 70, fluctuation: 0 },
      });
    if (
      url.pathname.endsWith("/exposure-trends") ||
      url.pathname.endsWith("/score-trends")
    )
      return fulfill(route, {
        brand_statistics: [],
        competitor_statistics: [],
      });
    if (
      url.pathname.endsWith("/exposure-rank") ||
      url.pathname.endsWith("/score-rank")
    )
      return fulfill(route, []);
    return route.fallback();
  });
}

const scopedPath = (path: string, index = 0) =>
  `${path}?${new URLSearchParams({ organizationId: fixture.scopes[index].organizationId, brandId: fixture.scopes[index].brandId })}`;

async function seedPublicationOrder(
  index = 0,
  status: "published" | "processing" = "published",
) {
  const channelId = randomUUID(),
    id = randomUUID();
  fixture.publicationChannelIds ??= [];
  fixture.publicationChannelIds.push(channelId);
  await database.db.insert(database.publicationChannels).values({
    id: channelId,
    name: "流程媒体",
    category: "科技",
    priceAmount: 100,
    provider: "manual",
  });
  const scope = fixture.scopes[index];
  const title = `${scope.name} 的发布文章 ${id.slice(0, 4)}`;
  const url = `https://example.com/published/${id}`;
  await database.db.insert(database.publicationOrders).values({
    id,
    channelId,
    organizationId: scope.organizationId,
    brandId: scope.brandId,
    status,
    title,
    resultUrl: status === "published" ? url : null,
    idempotencyKey: randomUUID(),
    priceAmount: 100,
    createdBy: fixture.userId,
  });
  return { id, title, url };
}

async function makePlatformAdministrator() {
  const { db, users, roles, platformUserRoles } = database;
  const { eq } = operators;
  const [role] = await db
    .select()
    .from(roles)
    .where(eq(roles.code, "super_admin"));
  await db
    .update(users)
    .set({ accountType: "admin" })
    .where(eq(users.id, fixture.userId));
  await db
    .insert(platformUserRoles)
    .values({ userId: fixture.userId, roleId: role.id });
}
async function makeEnterpriseAdministrator() {
  const {
    db,
    roles,
    users,
    organizationMembers,
    memberRoles,
    balanceAccounts,
  } = database;
  const { eq } = operators;
  await db
    .update(users)
    .set({ accountType: "agent", pricingTier: "bronze" })
    .where(eq(users.id, fixture.userId));
  const [role] = await db
    .select()
    .from(roles)
    .where(eq(roles.code, "tenant_admin"));
  const members = await db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, fixture.userId));
  await db
    .insert(memberRoles)
    .values(
      members.map((member) => ({ memberId: member.id, roleId: role.id })),
    );
  await db.insert(balanceAccounts).values(
    fixture.scopes.flatMap((scope) => [
      {
        organizationId: scope.organizationId,
        asset: "answerbit_points" as const,
        balance: 100,
      },
      {
        organizationId: scope.organizationId,
        asset: "publication_cny" as const,
        balance: 1000,
      },
    ]),
  );
}

async function mockAdminReads(page: Page) {
  await mockBusinessApis(page);
  await page.route("**/api/v1/admin/**", (route) => route.continue());
}

async function mockAnswerReads(
  page: Page,
  onDetail?: (route: Route) => Promise<void>,
) {
  await page.route("**/api/v1/answerbit/answers**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/answerbit/answers") {
      if (onDetail) return onDetail(route);
      return fulfill(route, {
        query: "回答详情",
        llm_output: "当前范围的内容",
        platform: "deepseek",
        date: "2026-09-23",
        score: 50,
        links: [],
      });
    }
    const scope = fixture.scopes.find(
      (item) => item.brandId === url.searchParams.get("brandId"),
    )!;
    return fulfill(route, {
      total: 1,
      scores: [
        {
          task_id: scope.brandId,
          query_id: "prompt-1",
          query_str: `${scope.name} 的回答`,
          platform: "deepseek",
          date: "2026-09-23",
          score: 50,
          avg_rank: 1,
          trace_article_cnt: 0,
          exposure: 1,
          title_name: "产品",
          language: "zh",
          zone: "cn",
        },
      ],
    });
  });
  await page.route("**/api/v1/answerbit/citations/**", (route) =>
    fulfill(route, { total: 0, reference_count: [] }),
  );
  await page.route("**/api/v1/answerbit/dashboard/platforms**", (route) =>
    fulfill(route, { deepseek: "DeepSeek" }),
  );
  await page.route("**/api/v1/report-exports?**", (route) =>
    fulfill(route, { list: [], pagination: { total: 0 } }),
  );
}

test.describe("真实运营操作闭环", () => {
  test.skip(
    process.env.WORKFLOW_E2E !== "1",
    "使用 scripts/test-operator-workflows.mjs 创建一次性测试数据库",
  );
  test.beforeAll(async () => {
    if (
      process.env.WORKFLOW_DISPOSABLE_DB !== "1" ||
      !/^\/geo_workflow_qa_[a-f0-9]+$/.test(
        new URL(process.env.DATABASE_URL!).pathname,
      )
    )
      throw new Error(
        "Use scripts/test-operator-workflows.mjs: workflow QA requires a disposable database",
      );
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
    const loginRequest = () =>
      page.request.post("/api/auth/sign-in/username", {
        headers: { Origin: process.env.APP_URL ?? "http://localhost:3000" },
        data: { username: fixture.username, password: fixture.password },
      });
    let login = await loginRequest();
    if (login.status() === 429) {
      // The suite shares one client IP; respect the real authentication rate limit.
      test.info().setTimeout(120_000);
      const seconds = Number(login.headers()["retry-after"]);
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60)
        throw new Error("Unexpected authentication Retry-After in workflow QA");
      console.info(`QA login throttled; waiting ${seconds}s before retry`);
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 500));
      login = await loginRequest();
    }
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
      operationLogs,
    } = database;
    const { eq, inArray } = operators;
    const ids = fixture.scopes.map((scope) => scope.organizationId);
    const audited = await db
      .select({ id: operationLogs.id })
      .from(operationLogs)
      .where(inArray(operationLogs.organizationId, ids))
      .limit(1);
    // Audits are immutable. The runner drops this disposable database after QA.
    if (audited.length) return;
    const reportHistory = await db
      .select({ id: database.reportExports.id })
      .from(database.reportExports)
      .where(inArray(database.reportExports.organizationId, ids))
      .limit(1);
    // Started reports are immutable; the runner removes the disposable database.
    if (reportHistory.length) return;
    await db
      .delete(database.publicationOrders)
      .where(inArray(database.publicationOrders.organizationId, ids));
    if (fixture.publicationChannelIds?.length)
      await db
        .delete(database.publicationChannels)
        .where(
          inArray(
            database.publicationChannels.id,
            fixture.publicationChannelIds,
          ),
        );
    await db
      .delete(database.balanceTransactions)
      .where(inArray(database.balanceTransactions.organizationId, ids));
    await db
      .delete(balanceAccounts)
      .where(inArray(balanceAccounts.organizationId, ids));
    await db
      .delete(brandAccess)
      .where(inArray(brandAccess.organizationId, ids));
    await db
      .delete(answerbitBrandMappings)
      .where(inArray(answerbitBrandMappings.organizationId, ids));
    await db
      .delete(database.notifications)
      .where(inArray(database.notifications.organizationId, ids));
    await db
      .delete(database.notificationRules)
      .where(inArray(database.notificationRules.organizationId, ids));
    await db
      .delete(answerbitTeamBindings)
      .where(inArray(answerbitTeamBindings.organizationId, ids));
    await db
      .delete(answerbitConnections)
      .where(inArray(answerbitConnections.organizationId, ids));
    await db
      .delete(organizationMembers)
      .where(inArray(organizationMembers.organizationId, ids));
    await db
      .delete(database.subscriptionEntitlements)
      .where(inArray(database.subscriptionEntitlements.organizationId, ids));
    await db
      .delete(database.platformSubscriptions)
      .where(inArray(database.platformSubscriptions.organizationId, ids));
    await db.delete(organizations).where(inArray(organizations.id, ids));
    await db
      .delete(users)
      .where(
        inArray(users.id, [fixture.userId, ...(fixture.extraUserIds ?? [])]),
      );
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

  test("文章生成响应丢失后刷新复用原提交，后续修改保留供明确再次生成", async ({
    page,
  }) => {
    const submitted: { key: string; input: Record<string, unknown> }[] = [];
    const jobs = new Map<
      string,
      {
        id: string;
        status: string;
        articleTitle: string;
        templateType: number;
        generationMode: string;
        createdAt: string;
      }
    >();
    await mockBusinessApis(page, async (route) => {
      const key = route.request().headers()["idempotency-key"];
      const input = route.request().postDataJSON();
      submitted.push({ key, input });
      const existing = jobs.get(key);
      const job = existing ?? {
        id: randomUUID(),
        status: "queued",
        articleTitle: `生成任务 ${jobs.size + 1}`,
        templateType: 1,
        generationMode: "standard",
        createdAt: new Date().toISOString(),
      };
      jobs.set(key, job);
      if (submitted.length === 1) return route.abort("failed");
      return fulfill(route, { ...job, replayed: Boolean(existing) });
    });
    await page.route("**/api/v1/answerbit/article-jobs?**", (route) =>
      fulfill(route, [...jobs.values()]),
    );
    await page.goto(
      `${scopedPath("/dashboard/content")}&stage=generate&promptId=prompt-1&promptText=${encodeURIComponent("如何选择品牌？")}`,
    );
    const knowledge = page.getByLabel("补充资料", { exact: true });
    await expect(
      page.getByText("如何选择品牌？ · 产品", { exact: true }),
    ).toBeVisible();
    await knowledge.fill("首次提交的素材");
    await page.getByRole("button", { name: /提交普通文章生成/ }).click();
    await expect(
      page.getByText("Failed to fetch", { exact: true }),
    ).toBeVisible();
    await knowledge.fill("提交之后补充的新素材");
    await page.reload();
    await expect(knowledge).toHaveValue("提交之后补充的新素材");
    await page.getByRole("button", { name: /确认上次提交/ }).click();
    await expect(
      page.getByText("上次提交已确认，后续输入已保留，可继续编辑后再次生成。", {
        exact: true,
      }),
    ).toBeVisible();
    expect(submitted).toHaveLength(2);
    expect(submitted[1]).toEqual(submitted[0]);
    expect(jobs.size).toBe(1);
    await expect(knowledge).toHaveValue("提交之后补充的新素材");
    await page.getByRole("button", { name: /提交普通文章生成/ }).click();
    await expect(
      page.getByText("生成任务已进入队列", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("生成任务 2", { exact: true })).toBeVisible();
    expect(submitted).toHaveLength(3);
    expect(submitted[2].key).not.toBe(submitted[0].key);
    expect(submitted[2].input.supplementalKnowledge).toBe(
      "提交之后补充的新素材",
    );
    expect(jobs.size).toBe(2);
  });

  test("普通与参考生成草稿跨企业、页面及刷新恢复，主题与多尺寸可用", async ({
    page,
  }) => {
    await mockBusinessApis(page);
    await page.addInitScript({ content: axe.source });
    await page.route("**/api/v1/answerbit/article-templates?**", (route) =>
      fulfill(route, [
        {
          template_id: 1,
          template_name: "普通文章模板",
          description: "普通",
          is_high_ref: 0,
        },
        {
          template_id: 2,
          template_name: "参考文章模板",
          description: "参考",
          is_high_ref: 1,
        },
      ]),
    );
    await page.goto(
      `${scopedPath("/dashboard/content")}&stage=generate&promptId=prompt-1`,
    );
    const knowledge = page.getByLabel("补充资料", { exact: true });
    await expect(
      page.getByText("如何选择品牌？ · 产品", { exact: true }),
    ).toBeVisible();
    await knowledge.fill("企业 A 的普通素材");
    await page.getByLabel("文章标签（可选）", { exact: true }).fill("草稿标签");
    await page.getByLabel("文章标签（可选）", { exact: true }).press("Enter");
    await page.getByRole("tab", { name: "参考文章生成", exact: true }).click();
    await knowledge.fill("企业 A 的参考素材");
    const reference = page.getByLabel("参考文章链接", { exact: true });
    await reference.fill("https://example.com/reference-a");
    await page.getByRole("tab", { name: "普通文章生成", exact: true }).click();
    await expect(knowledge).toHaveValue("企业 A 的普通素材");
    await page.getByRole("tab", { name: "参考文章生成", exact: true }).click();
    await expect(knowledge).toHaveValue("企业 A 的参考素材");
    await expect(reference).toHaveValue("https://example.com/reference-a");
    await page.goto(scopedPath("/dashboard/content", 1));
    await expect(knowledge).toHaveValue("");
    await knowledge.fill("企业 B 的独立素材");
    await page.goto(scopedPath("/dashboard/content"));
    await expect(knowledge).toHaveValue("企业 A 的参考素材");
    await expect(reference).toHaveValue("https://example.com/reference-a");
    await page.getByRole("tab", { name: "文档库", exact: true }).click();
    await page.getByRole("tab", { name: "AI 生成", exact: true }).click();
    await expect(reference).toHaveValue("https://example.com/reference-a");
    await page.reload();
    await expect(knowledge).toHaveValue("企业 A 的参考素材");
    await expect(reference).toHaveValue("https://example.com/reference-a");
    for (const theme of ["light", "dark"]) {
      if (theme === "dark")
        await page.getByRole("button", { name: "切换亮暗色模式" }).click();
      await expect
        .poll(() => page.locator("html").getAttribute("data-theme"))
        .toBe(theme);
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.effect?.getComputedTiming().iterations !== Infinity,
            )
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      const violations = await page.evaluate(async () =>
        (
          await (window as typeof window & { axe: typeof axe }).axe.run(
            document,
            {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
              },
            },
          )
        ).violations.map(({ id, nodes }) => ({
          id,
          targets: nodes.map(({ target }) => target.join(" ")),
        })),
      );
      expect(violations).toEqual([]);
    }
  });

  test("后台订单按企业与人工队列分页，处理后回退末页，条件与明暗主题可恢复", async ({
    page,
  }) => {
    const seed = await seedPublicationOrder(0, "processing");
    const { db, publicationOrders } = database;
    const { eq } = operators;
    const [first] = await db
      .select()
      .from(publicationOrders)
      .where(eq(publicationOrders.id, seed.id));
    await db.delete(publicationOrders).where(eq(publicationOrders.id, seed.id));
    const keyword = `后台队列 ${randomUUID().slice(0, 8)}`;
    const ids = Array.from({ length: 21 }, () => randomUUID());
    await db.insert(publicationOrders).values(
      ids.map((id, index) => ({
        id,
        channelId: first.channelId,
        organizationId: first.organizationId,
        brandId: first.brandId,
        title: `${keyword} ${index}`,
        status: "submitted" as const,
        priceAmount: 0,
        createdBy: fixture.userId,
        idempotencyKey: id,
        createdAt: new Date("2026-09-15T00:00:00Z"),
      })),
    );
    const other = await seedPublicationOrder(1);
    await db
      .update(publicationOrders)
      .set({ title: `${keyword} 交付` })
      .where(eq(publicationOrders.id, other.id));
    expect(
      (await page.request.get("/api/v1/admin/publication-orders")).status(),
    ).toBe(403);
    expect(
      (
        await page.request.get(`/api/v1/admin/publication-orders/${ids[0]}`)
      ).status(),
    ).toBe(403);
    await makePlatformAdministrator();
    expect(
      (
        await page.request.get("/api/v1/admin/publication-orders?pageSize=101")
      ).status(),
    ).toBe(400);
    expect(
      (
        await page.request.get("/api/v1/admin/publication-orders/not-a-uuid")
      ).status(),
    ).toBe(400);
    await mockAdminReads(page);
    await page.goto(
      `/admin?section=publication-orders&orderKeyword=${encodeURIComponent(keyword)}`,
    );
    await expect(page.getByText("共 22 条订单", { exact: true })).toBeVisible();
    await expect(page.locator("tbody tr.ant-table-row")).toHaveCount(20);
    await page.locator(".ant-pagination-item-2").click();
    await expect(page.locator("tbody tr.ant-table-row")).toHaveCount(2);
    await expect(page).toHaveURL(/orderPage=2/);
    await page
      .getByRole("button", { name: "待处理人工订单", exact: true })
      .click();
    await expect(page.getByText("共 21 条订单", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/orderProvider=manual/);
    await expect(page).toHaveURL(/orderStatus=submitted/);
    await page.locator(".ant-pagination-item-2").click();
    await expect(page.locator("tbody tr.ant-table-row")).toHaveCount(1);
    await page.getByRole("button", { name: "开始处理", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "处理发布订单" });
    await expect(
      dialog.getByText("处理为：处理中", { exact: true }),
    ).toBeVisible();
    await dialog
      .getByLabel("处理说明", { exact: true })
      .fill("开始安排人工发布");
    await dialog.getByRole("button", { name: "确认处理", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("共 20 条订单", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/orderPage=1/);
    await page.getByLabel("所属企业", { exact: true }).press("ArrowDown");
    await page
      .getByLabel("所属企业", { exact: true })
      .fill(fixture.scopes[1].name);
    await page
      .locator(".ant-select-dropdown")
      .getByText(fixture.scopes[1].name, { exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`orderOrganizationId=${fixture.scopes[1].organizationId}`),
    );
    await expect(
      page.getByText("没有符合筛选条件的订单", { exact: true }),
    ).toBeVisible();
    const filtered = new URL(page.url());
    filtered.searchParams.set("orderBeginDate", "2026-09-01");
    filtered.searchParams.set("orderEndDate", "2026-09-30");
    await page.goto(filtered.href);
    await expect(page.getByLabel("查找订单", { exact: true })).toHaveValue(
      keyword,
    );
    await expect(page.getByLabel("提交日期", { exact: true })).toHaveValue(
      "2026-09-01",
    );
    await expect(page.getByLabel("提交结束日期", { exact: true })).toHaveValue(
      "2026-09-30",
    );
    await page.getByRole("menuitem", { name: /发布渠道/ }).click();
    await expect(page).toHaveURL(/section=publication-channels/);
    await expect(
      page.getByRole("heading", { name: "发布渠道", exact: true }),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: /发布订单/ }).click();
    await expect(page).toHaveURL(/section=publication-orders/);
    await expect(
      page.getByText("没有符合筛选条件的订单", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("查找订单", { exact: true })).toHaveValue(
      keyword,
    );
    for (const theme of ["light", "dark"]) {
      if (theme === "dark")
        await page.getByRole("button", { name: "切换亮暗色模式" }).click();
      await expect
        .poll(() => page.locator("html").getAttribute("data-theme"))
        .toBe(theme);
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBeTruthy();
        await page.evaluate(async () => {
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.effect?.getComputedTiming().iterations !== Infinity,
              )
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        await page.evaluate(axe.source);
        const result = await page.evaluate(async () =>
          (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          }),
        );
        expect(
          result.violations.map(({ id, nodes }) => ({
            id,
            targets: nodes.map(({ target }) => target),
          })),
        ).toEqual([]);
      }
    }
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await page.getByLabel("查找订单", { exact: true }).fill(other.id);
    await page.getByLabel("查找订单", { exact: true }).press("Enter");
    await expect(
      page.getByText(`${keyword} 交付`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "填写交付", exact: true }),
    ).toHaveCount(0);
  });

  test("后台人工交付失败保留表单，响应丢失核对原结果，失败返还仅执行一次", async ({
    page,
  }) => {
    const seed = await seedPublicationOrder(0, "processing");
    const { db, publicationOrders, balanceAccounts, balanceTransactions } =
      database;
    const { eq, and } = operators;
    const [row] = await db
      .select()
      .from(publicationOrders)
      .where(eq(publicationOrders.id, seed.id));
    await db.delete(publicationOrders).where(eq(publicationOrders.id, seed.id));
    const create = async (title: string) => {
      const result = await database.createPublicationOrderWithBalance({
        organizationId: row.organizationId,
        brandId: row.brandId,
        channelId: row.channelId,
        title,
        note: "待处理说明",
        createdBy: fixture.userId,
        idempotencyKey: randomUUID(),
      });
      if (!result.ok) throw new Error("QA order debit failed");
      return result.order;
    };
    const first = await create("人工交付测试");
    await database.updatePublicationOrder({
      orderId: first.id,
      status: "processing",
    });
    await makePlatformAdministrator();
    await mockAdminReads(page);
    let attempts = 0;
    await page.route(
      `**/api/v1/admin/publication-orders/${first.id}`,
      async (route) => {
        if (route.request().method() !== "PATCH") return route.continue();
        attempts++;
        if (attempts === 1)
          return route.fulfill({
            status: 503,
            json: { error: { message: "模拟保存失败" } },
          });
        const result = await route.fetch();
        expect(result.ok()).toBeTruthy();
        await route.abort("failed");
      },
    );
    await page.goto(
      `/admin?section=publication-orders&orderKeyword=${first.id}`,
    );
    await expect(page.getByText(first.title, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "开始处理", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "填写交付", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "处理发布订单" });
    const url = dialog.getByLabel("发布结果 URL", { exact: true });
    await url.fill("ftp://example.com/article");
    await dialog.getByRole("button", { name: "确认处理", exact: true }).click();
    await expect(
      dialog.getByText("交付链接须使用 HTTP 或 HTTPS", { exact: true }),
    ).toBeVisible();
    expect(attempts).toBe(0);
    await url.fill("https://example.com/manual-result");
    await dialog
      .getByLabel("处理说明", { exact: true })
      .fill("人工交付核对说明");
    await dialog.getByRole("button", { name: "确认处理", exact: true }).click();
    await expect(
      dialog.getByText("模拟保存失败", { exact: true }),
    ).toBeVisible();
    await expect(url).toHaveValue("https://example.com/manual-result");
    await expect(dialog.getByLabel("处理说明", { exact: true })).toHaveValue(
      "人工交付核对说明",
    );
    await dialog.getByRole("button", { name: "确认处理", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText("已核对订单，处理结果已保存", { exact: true }),
    ).toBeVisible();
    const saved = await page.request.get(
      `/api/v1/admin/publication-orders/${first.id}`,
    );
    expect((await saved.json()).data.order).toMatchObject({
      status: "published",
      resultUrl: "https://example.com/manual-result",
      note: "人工交付核对说明",
    });
    expect(attempts).toBe(2);
    const failed = await create("人工失败返还测试");
    let returns = 0,
      failRead = false;
    await page.route(
      `**/api/v1/admin/publication-orders/${failed.id}`,
      async (route) => {
        if (route.request().method() !== "PATCH") return route.continue();
        returns++;
        const result = await route.fetch();
        expect(result.ok()).toBeTruthy();
        failRead = true;
        await route.abort("failed");
      },
    );
    await page.route("**/api/v1/admin/publication-orders?**", (route) =>
      failRead
        ? route.fulfill({
            status: 503,
            json: { error: { message: "列表刷新失败" } },
          })
        : route.continue(),
    );
    await page.getByLabel("查找订单", { exact: true }).fill(failed.id);
    await page.getByLabel("查找订单", { exact: true }).press("Enter");
    await expect(page.getByText(failed.title, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "失败返还", exact: true }).click();
    await expect(dialog.getByText(/返还至原品牌余额/)).toContainText("1.00");
    await dialog
      .getByLabel("处理说明", { exact: true })
      .fill("渠道无法完成发布");
    await dialog
      .getByRole("button", { name: "确认失败并返还", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText("已核对订单，处理结果已保存", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("列表刷新失败", { exact: true })).toBeVisible();
    failRead = false;
    await page.getByRole("button", { name: /重\s*试/ }).click();
    await expect(page.getByText("失败已返还", { exact: true })).toBeVisible();
    expect(returns).toBe(1);
    const ledger = await db
      .select()
      .from(balanceTransactions)
      .where(
        and(
          eq(balanceTransactions.referenceId, failed.id),
          eq(balanceTransactions.operation, "restore"),
        ),
      );
    expect(ledger).toHaveLength(1);
    expect(ledger[0].amount).toBe(100);
    const [account] = await db
      .select()
      .from(balanceAccounts)
      .where(
        and(
          eq(balanceAccounts.organizationId, row.organizationId),
          eq(balanceAccounts.brandId, row.brandId),
          eq(balanceAccounts.asset, "publication_cny"),
        ),
      );
    expect(account.balance).toBe(9900);
  });

  for (const scenario of ["权限变化", "提交锁"] as const) {
    test(`发布申诉${scenario}保留说明，禁止重复或无权限提交，恢复后继续`, async ({
      page,
    }) => {
      const order = await seedPublicationOrder(0, "processing");
      const target = fixture.scopes[0];
      const writes: Record<string, unknown>[] = [];
      let fail = scenario === "提交锁",
        submitted = false,
        releaseWrite!: () => void;
      const writeWait = new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      await mockBusinessApis(page, async (route) => {
        if (!new URL(route.request().url()).pathname.endsWith("/appeal"))
          return route.continue();
        writes.push(route.request().postDataJSON());
        submitted = true;
        if (fail) {
          await writeWait;
          await route.fulfill({
            status: 422,
            json: { error: { message: "申诉原因需要补充" } },
          });
        } else await fulfill(route, {});
      });
      await page.route("**/api/v1/publication-orders?**", (route) =>
        route.fulfill({
          json: {
            ...envelope([
              {
                order: {
                  id: order.id,
                  title: order.title,
                  status: "processing",
                  priceAmount: 100,
                  currency: "CNY",
                  resultUrl: null,
                  providerOrderId: "upstream-order",
                  providerStatus: 3,
                  providerMessage: null,
                  createdAt: new Date().toISOString(),
                },
                channel,
              },
            ]),
            pagination: { page: 1, pageSize: 20, total: 1, pages: 1 },
          },
        }),
      );
      let holdBrand = false,
        brandRequested = false,
        releaseBrand!: () => void;
      const brandWait = new Promise<void>((resolve) => {
        releaseBrand = resolve;
      });
      await page.route("**/api/v1/answerbit/brands?**", async (route) => {
        if (holdBrand) {
          brandRequested = true;
          await brandWait;
        }
        await route.continue();
      });
      const setRole = (role: "brand_admin" | "brand_viewer") =>
        database.db
          .update(database.brandAccess)
          .set({ role })
          .where(
            operators.and(
              operators.eq(database.brandAccess.userId, fixture.userId),
              operators.eq(
                database.brandAccess.organizationId,
                target.organizationId,
              ),
            ),
          );
      await page.goto(scopedPath("/dashboard/publication/orders"));
      const open = page.getByRole("button", { name: /申\s*诉/ });
      await expect(open).toBeEnabled();
      if (scenario === "权限变化") {
        await setRole("brand_viewer");
        holdBrand = true;
        await page
          .getByRole("button", { name: "刷新品牌范围", exact: true })
          .click();
        await expect.poll(() => brandRequested).toBe(true);
      }
      await open.click();
      const dialog = page.getByRole("dialog", {
        name: "聚合发布订单申诉",
        exact: true,
      });
      const reason = dialog.getByLabel("申诉原因", { exact: true });
      await reason.focus();
      await reason.press("ArrowDown");
      await page
        .locator(".ant-select-dropdown")
        .getByText("其他原因", { exact: true })
        .click();
      const detail = dialog.getByLabel("具体说明", { exact: true });
      await detail.fill("尚未提交的原申诉说明");
      const submit = dialog.getByRole("button", {
        name: "提交申诉",
        exact: true,
      });
      if (scenario === "权限变化") {
        holdBrand = false;
        releaseBrand();
        await expect(
          dialog.getByText("当前品牌已没有提交发布申诉权限", { exact: true }),
        ).toBeVisible();
        await expect(submit).toBeDisabled();
        await expect(detail).toHaveAttribute("readonly", "");
        await expect(detail).toHaveValue("尚未提交的原申诉说明");
        const native = await page.request.post(
          `/api/v1/publication-orders/${order.id}/appeal`,
          {
            data: {
              organizationId: target.organizationId,
              teamBindingId: target.teamBindingId,
              brandId: target.brandId,
              reason: 4,
              detail: "尚未提交的原申诉说明",
            },
          },
        );
        expect(native.status()).toBe(403);
        expect(writes).toHaveLength(0);
        await setRole("brand_admin");
        await dialog
          .getByRole("button", { name: "重新检查权限", exact: true })
          .click();
        await expect(submit).toBeEnabled();
        await expect(detail).toHaveValue("尚未提交的原申诉说明");
        await submit.click();
      } else {
        await submit.click();
        await expect.poll(() => submitted).toBe(true);
        await expect(detail).toBeDisabled();
        await expect(reason).toBeDisabled();
        await expect(
          dialog.getByRole("button", { name: /取\s*消/ }),
        ).toBeDisabled();
        await expect(dialog.locator(".ant-modal-close")).toHaveCount(0);
        await expect(
          page.locator("tbody").getByRole("button", { name: /取\s*消/ }),
        ).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeVisible();
        expect(writes).toHaveLength(1);
        releaseWrite();
        await expect(
          dialog.getByText("申诉原因需要补充", { exact: true }),
        ).toBeVisible();
        await expect(detail).toHaveValue("尚未提交的原申诉说明");
        await expect(submit).toBeEnabled();
        fail = false;
        await submit.click();
      }
      await expect(dialog).toBeHidden();
      expect(writes).toHaveLength(scenario === "权限变化" ? 1 : 2);
      for (const input of writes) {
        expect(input.reason).toBe(4);
        expect(input.detail).toBe("尚未提交的原申诉说明");
        expect(input.organizationId).toBe(target.organizationId);
        expect(input.brandId).toBe(target.brandId);
      }
    });
  }

  for (const action of ["cancel", "appeal"] as const) {
    test(`发布${action}响应丢失后刷新恢复，跨品牌隔离并只读核对原订单`, async ({
      page,
    }) => {
      const seed = await seedPublicationOrder(0, "processing");
      const target = fixture.scopes[0];
      let writes = 0,
        failCheck = true,
        accepted = false;
      const checks: URL[] = [];
      const order = {
        id: seed.id,
        title: seed.title,
        status: "processing",
        priceAmount: 100,
        currency: "CNY",
        resultUrl: null,
        providerOrderId: "upstream",
        providerStatus: 1,
        providerMessage: null,
        createdAt: new Date().toISOString(),
      };
      await mockBusinessApis(page, async (route) => {
        if (!new URL(route.request().url()).pathname.endsWith(`/${action}`))
          return route.continue();
        writes++;
        accepted = true;
        await route.abort("failed");
      });
      await page.route("**/api/v1/publication-orders?**", async (route) => {
        const url = new URL(route.request().url());
        const checking = url.searchParams.get("keyword") === seed.id;
        if (checking) {
          checks.push(url);
          if (failCheck)
            return route.fulfill({
              status: 503,
              json: { error: { message: "原订单核对暂不可用" } },
            });
        }
        const matches =
          url.searchParams.get("brandId") === target.brandId &&
          (!url.searchParams.get("keyword") || checking);
        const row = accepted
          ? {
              ...order,
              status: action === "cancel" ? "cancelled" : "processing",
              providerStatus: action === "appeal" ? 9 : 1,
            }
          : order;
        await route.fulfill({
          json: {
            ...envelope(matches ? [{ order: row, channel }] : []),
            pagination: {
              page: 1,
              pageSize: 20,
              total: matches ? 1 : 0,
              pages: matches ? 1 : 0,
            },
          },
        });
      });
      await page.goto(scopedPath("/dashboard/publication/orders"));
      if (action === "cancel") {
        await page
          .locator("tbody")
          .getByRole("button", { name: /取\s*消/ })
          .click();
        await page
          .getByRole("button", { name: "确认取消", exact: true })
          .click();
      } else {
        await page.getByRole("button", { name: /申\s*诉/ }).click();
        const dialog = page.getByRole("dialog", { name: "聚合发布订单申诉" });
        const reason = dialog.getByLabel("申诉原因", { exact: true });
        await reason.focus();
        await reason.press("ArrowDown");
        await page
          .locator(".ant-select-dropdown")
          .getByText("其他原因", { exact: true })
          .click();
        await dialog
          .getByLabel("具体说明", { exact: true })
          .fill("响应丢失前的原说明");
        await dialog
          .getByRole("button", { name: "提交申诉", exact: true })
          .click();
        await expect(
          dialog.getByText(
            "发布操作结果尚未确认，请核对订单状态，不要重复提交。",
            { exact: true },
          ),
        ).toBeVisible();
        await expect(
          dialog.getByRole("button", { name: "提交申诉", exact: true }),
        ).toBeDisabled();
        await dialog.getByRole("button", { name: /取\s*消/ }).click();
      }
      await expect(
        page.getByText("发布操作结果待核对", { exact: true }),
      ).toBeVisible();
      expect(writes).toBe(1);
      if (action === "cancel") {
        for (const theme of ["light", "dark"]) {
          if (theme === "dark")
            await page.getByRole("button", { name: "切换亮暗色模式" }).click();
          await expect
            .poll(() => page.locator("html").getAttribute("data-theme"))
            .toBe(theme);
          for (const width of [390, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            const layout = await page.evaluate(() => ({
              width: innerWidth,
              scrollWidth: document.documentElement.scrollWidth,
              overflow: Array.from(document.querySelectorAll("body *"))
                .filter(
                  (element) =>
                    element.getBoundingClientRect().right > innerWidth,
                )
                .slice(0, 15)
                .map((element) => ({
                  tag: element.tagName,
                  className: element.className,
                  right: element.getBoundingClientRect().right,
                })),
            }));
            await page.evaluate(async () => {
              await Promise.all(
                document
                  .getAnimations()
                  .filter(
                    (animation) =>
                      animation.effect?.getComputedTiming().iterations !==
                      Infinity,
                  )
                  .map((animation) => animation.finished.catch(() => {})),
              );
            });
            await expect
              .poll(
                () => page.evaluate(() => document.documentElement.scrollWidth),
                { message: JSON.stringify(layout) },
              )
              .toBeLessThanOrEqual(width);
            await page.evaluate(axe.source);
            const result = await page.evaluate(async () =>
              (window as unknown as { axe: typeof axe }).axe.run(document, {
                runOnly: {
                  type: "tag",
                  values: ["wcag2a", "wcag2aa", "wcag21aa"],
                },
              }),
            );
            expect(result.violations).toEqual([]);
          }
        }
      }
      await page
        .getByLabel("查找订单", { exact: true })
        .fill("隐藏原订单的筛选");
      await page.getByLabel("查找订单", { exact: true }).press("Enter");
      await expect(
        page.getByText("没有符合筛选条件的订单", { exact: true }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByText("发布操作结果待核对", { exact: true }),
      ).toBeVisible();
      if (action === "appeal")
        await expect(
          page.getByText("具体说明：响应丢失前的原说明", { exact: true }),
        ).toBeVisible();
      await page
        .getByRole("button", { name: "核对订单状态", exact: true })
        .click();
      await expect(
        page.getByText("原订单核对暂不可用", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "已核对，结束本次操作", exact: true }),
      ).toBeDisabled();
      await page.goto(scopedPath("/dashboard/publication/orders", 1));
      await expect(
        page.getByText("发布操作结果待核对", { exact: true }),
      ).toBeHidden();
      await page.goto(
        `${scopedPath("/dashboard/publication/orders")}&keyword=隐藏原订单的筛选`,
      );
      await expect(
        page.getByText("发布操作结果待核对", { exact: true }),
      ).toBeVisible();
      failCheck = false;
      await page
        .getByRole("button", { name: "核对订单状态", exact: true })
        .click();
      await expect(
        page.getByText(
          action === "cancel"
            ? "已核对：订单已取消，发布余额已返还"
            : "已核对：订单已进入售后处理",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByText("发布操作结果待核对", { exact: true }),
      ).toBeHidden();
      expect(writes).toBe(1);
      expect(checks).toHaveLength(2);
      for (const url of checks) {
        expect(url.searchParams.get("organizationId")).toBe(
          target.organizationId,
        );
        expect(url.searchParams.get("brandId")).toBe(target.brandId);
        expect(url.searchParams.get("keyword")).toBe(seed.id);
        expect(url.searchParams.has("status")).toBe(false);
      }
      await page.reload();
      await expect(
        page.getByText("发布操作结果待核对", { exact: true }),
      ).toBeHidden();
      expect(writes).toBe(1);
    });
  }

  test("发布申诉切换企业后返回仍在提交的原范围，完成后解除锁定并刷新", async ({
    page,
  }) => {
    const seed = await seedPublicationOrder(0, "processing");
    let writes = 0,
      accepted = false,
      release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockBusinessApis(page, async (route) => {
      if (!new URL(route.request().url()).pathname.endsWith("/appeal"))
        return route.continue();
      writes++;
      await held;
      accepted = true;
      await fulfill(route, {
        id: seed.id,
        status: "processing",
        providerStatus: 9,
      });
    });
    await page.route("**/api/v1/publication-orders?**", (route) => {
      const own =
        new URL(route.request().url()).searchParams.get("brandId") ===
        fixture.scopes[0].brandId;
      return route.fulfill({
        json: {
          ...envelope(
            own
              ? [
                  {
                    order: {
                      id: seed.id,
                      title: seed.title,
                      status: "processing",
                      priceAmount: 100,
                      currency: "CNY",
                      providerOrderId: "upstream",
                      providerStatus: accepted ? 9 : 1,
                      providerMessage: null,
                      createdAt: new Date().toISOString(),
                    },
                    channel,
                  },
                ]
              : [],
          ),
          pagination: {
            page: 1,
            pageSize: 20,
            total: own ? 1 : 0,
            pages: own ? 1 : 0,
          },
        },
      });
    });
    await page.goto(scopedPath("/dashboard/publication/orders"));
    await page.getByRole("button", { name: /申\s*诉/ }).click();
    const dialog = page.getByRole("dialog", { name: "聚合发布订单申诉" });
    const reason = dialog.getByLabel("申诉原因", { exact: true });
    await reason.focus();
    await reason.press("ArrowDown");
    await page
      .locator(".ant-select-dropdown")
      .getByText("其他原因", { exact: true })
      .click();
    await dialog.getByRole("button", { name: "提交申诉", exact: true }).click();
    await expect.poll(() => writes).toBe(1);
    // A modal locks pointer navigation while submitting; browser history still allows leaving.
    await page.evaluate(
      (url) => window.history.pushState(null, "", url),
      scopedPath("/dashboard/publication/orders", 1),
    );
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText("原发布操作仍在提交中", { exact: true }),
    ).toBeHidden();
    await page.evaluate(
      (url) => window.history.pushState(null, "", url),
      scopedPath("/dashboard/publication/orders"),
    );
    await expect(
      page.getByText("原发布操作仍在提交中", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "核对订单状态", exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: /申\s*诉/ })).toBeDisabled();
    release();
    await expect(
      page.getByText("原发布操作仍在提交中", { exact: true }),
    ).toBeHidden();
    await expect(page.getByRole("button", { name: /申\s*诉/ })).toBeEnabled();
    expect(writes).toBe(1);
    await page.reload();
    await expect(
      page.getByText("发布操作结果待核对", { exact: true }),
    ).toBeHidden();
  });

  test("发布申诉未知结果核对后明确结束，不宣称成功也不重发", async ({
    page,
  }) => {
    const seed = await seedPublicationOrder(0, "processing");
    let writes = 0;
    await mockBusinessApis(page, async (route) => {
      if (!new URL(route.request().url()).pathname.endsWith("/appeal"))
        return route.continue();
      writes++;
      await route.fulfill({
        status: 504,
        json: { error: { message: "申诉暂未确认" } },
      });
    });
    await page.route("**/api/v1/publication-orders?**", (route) =>
      route.fulfill({
        json: {
          ...envelope([
            {
              order: {
                id: seed.id,
                title: seed.title,
                status: "processing",
                priceAmount: 100,
                currency: "CNY",
                providerOrderId: "upstream",
                providerStatus: 1,
                providerMessage: null,
                createdAt: new Date().toISOString(),
              },
              channel,
            },
          ]),
          pagination: { page: 1, pageSize: 20, total: 1, pages: 1 },
        },
      }),
    );
    await page.goto(scopedPath("/dashboard/publication/orders"));
    await page.getByRole("button", { name: /申\s*诉/ }).click();
    const dialog = page.getByRole("dialog", { name: "聚合发布订单申诉" });
    const reason = dialog.getByLabel("申诉原因", { exact: true });
    await reason.focus();
    await reason.press("ArrowDown");
    await page
      .locator(".ant-select-dropdown")
      .getByText("其他原因", { exact: true })
      .click();
    await dialog.getByRole("button", { name: "提交申诉", exact: true }).click();
    await expect(
      dialog.getByText("发布操作结果尚未确认，请核对订单状态，不要重复提交。", {
        exact: true,
      }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: /取\s*消/ }).click();
    const finish = page.getByRole("button", {
      name: "已核对，结束本次操作",
      exact: true,
    });
    await expect(finish).toBeDisabled();
    await page
      .getByRole("button", { name: "核对订单状态", exact: true })
      .click();
    await expect(page.getByText(/尚不能确认原操作结果/)).toBeVisible();
    await expect(finish).toBeEnabled();
    await finish.click();
    await page.getByRole("button", { name: "确认结束", exact: true }).click();
    await expect(
      page.getByText("本次核对已结束，请以订单实际状态为准。", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("发布操作结果待核对", { exact: true }),
    ).toBeHidden();
    await expect(
      page.getByText("发布申诉已提交", { exact: true }),
    ).toBeHidden();
    expect(writes).toBe(1);
    await expect(page.getByRole("button", { name: /申\s*诉/ })).toBeEnabled();
  });

  test("发布取消暂存失败不发送请求，存储恢复后正常提交", async ({ page }) => {
    const seed = await seedPublicationOrder(0, "processing");
    let writes = 0;
    await mockBusinessApis(page, async (route) => {
      writes++;
      await fulfill(route, { id: seed.id, status: "cancelled" });
    });
    await page.route("**/api/v1/publication-orders?**", (route) =>
      route.fulfill({
        json: {
          ...envelope([
            {
              order: {
                id: seed.id,
                title: seed.title,
                status: "processing",
                priceAmount: 100,
                currency: "CNY",
                providerOrderId: "upstream",
                providerStatus: 1,
                providerMessage: null,
                createdAt: new Date().toISOString(),
              },
              channel,
            },
          ]),
          pagination: { page: 1, pageSize: 20, total: 1, pages: 1 },
        },
      }),
    );
    await page.goto(scopedPath("/dashboard/publication/orders"));
    const cancel = page
      .locator("tbody")
      .getByRole("button", { name: /取\s*消/ });
    await expect(cancel).toBeEnabled();
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      (
        window as typeof window & { restoreOperationStorage?: () => void }
      ).restoreOperationStorage = () => {
        Storage.prototype.setItem = original;
      };
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("geo-publication-action:"))
          throw new Error("storage unavailable");
        return original.call(this, key, value);
      };
    });
    await cancel.click();
    await page.getByRole("button", { name: "确认取消", exact: true }).click();
    await expect(
      page.getByText(
        "无法暂存本次操作，尚未发送请求；请恢复浏览器存储后再试。",
        { exact: true },
      ),
    ).toBeVisible();
    expect(writes).toBe(0);
    await page.evaluate(() =>
      (
        window as typeof window & { restoreOperationStorage?: () => void }
      ).restoreOperationStorage?.(),
    );
    await cancel.click();
    await page.getByRole("button", { name: "确认取消", exact: true }).click();
    await expect(
      page.getByText("发布订单已取消，发布余额已返还", { exact: true }),
    ).toBeVisible();
    expect(writes).toBe(1);
  });

  for (const lostResponse of [false, true]) {
    test(`发布服务器待核对在新浏览器恢复，核对保存${lostResponse ? "响应丢失" : "成功"}后解除且不退款`, async ({
      page,
    }) => {
      const seed = await seedPublicationOrder(0, "processing");
      const target = fixture.scopes[0];
      const action = {
        id: randomUUID(),
        operation: "cancel" as const,
        state: "uncertain" as const,
        actorUserId: fixture.userId,
        startedAt: new Date(Date.now() - 90_000).toISOString(),
        expiresAt: new Date(Date.now() - 1).toISOString(),
      };
      await database.db
        .update(database.publicationOrders)
        .set({ providerAction: action })
        .where(operators.eq(database.publicationOrders.id, seed.id));
      let writes = 0,
        cancellations = 0;
      await mockBusinessApis(page, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/cancel")) cancellations++;
        if (!path.endsWith("/action-resolution")) return route.continue();
        writes++;
        if (!lostResponse) return route.continue();
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort("failed");
      });
      await page.goto(scopedPath("/dashboard/publication/orders"));
      await expect(
        page.getByText("取消操作待核对", { exact: true }),
      ).toBeVisible();
      await expect(
        page.locator("tbody").getByRole("button", { name: /取\s*消/ }),
      ).toBeDisabled();
      await expect(
        page.getByText("发布操作结果待核对", { exact: true }),
      ).toBeHidden();
      const blocked = await page.request.post(
        `/api/v1/publication-orders/${seed.id}/cancel`,
        { data: { ...target, name: undefined, actionRequestId: randomUUID() } },
      );
      expect(blocked.status()).toBe(409);
      expect((await blocked.json()).error.code).toBe(
        "PUBLICATION_ACTION_RECONCILIATION_REQUIRED",
      );
      await page
        .getByRole("button", { name: `核对原操作 ${seed.id}`, exact: true })
        .click();
      await expect(
        page.getByText("发布操作结果待核对", { exact: true }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByText("发布操作结果待核对", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "核对订单状态", exact: true })
        .click();
      const note = page.getByLabel("上游核对说明", { exact: true });
      await expect(note).toBeVisible();
      const finish = page.getByRole("button", {
        name: "已核对，结束本次操作",
        exact: true,
      });
      await expect(finish).toBeDisabled();
      const setRole = (role: "brand_admin" | "brand_viewer") =>
        database.db
          .update(database.brandAccess)
          .set({ role })
          .where(
            operators.and(
              operators.eq(database.brandAccess.userId, fixture.userId),
              operators.eq(
                database.brandAccess.organizationId,
                target.organizationId,
              ),
            ),
          );
      if (!lostResponse) {
        await setRole("brand_viewer");
        await page
          .getByRole("button", { name: "刷新品牌范围", exact: true })
          .click();
        await expect(
          page.getByText(
            "当前权限只允许查看和核对，结束核对需要发布操作权限。",
            { exact: true },
          ),
        ).toBeVisible();
        await expect(note).toBeDisabled();
        const denied = await page.request.post(
          `/api/v1/publication-orders/${seed.id}/action-resolution`,
          {
            data: {
              organizationId: target.organizationId,
              teamBindingId: target.teamBindingId,
              brandId: target.brandId,
              actionId: action.id,
              note: "查看者不能结束",
            },
          },
        );
        expect(denied.status()).toBe(403);
        await setRole("brand_admin");
        await page
          .getByRole("button", { name: "刷新品牌范围", exact: true })
          .click();
        await expect(note).toBeEnabled();
        const wrong = fixture.scopes[1];
        const isolated = await page.request.post(
          `/api/v1/publication-orders/${seed.id}/action-resolution`,
          {
            data: {
              organizationId: wrong.organizationId,
              teamBindingId: wrong.teamBindingId,
              brandId: wrong.brandId,
              actionId: action.id,
              note: "其他企业核对",
            },
          },
        );
        expect(isolated.status()).toBe(404);
      }
      await note.fill("已核对上游后台，订单尚未取消；本次结束核对");
      await finish.click();
      await page.getByRole("button", { name: "确认结束", exact: true }).click();
      if (lostResponse) {
        await expect(
          page.getByText("核对结果暂未确认，请继续读取原订单核对。", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByText("发布操作结果待核对", { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "核对订单状态", exact: true })
          .click();
        await expect(
          page.getByText("已核对：原操作已结束，请检查当前订单状态后继续", {
            exact: true,
          }),
        ).toBeVisible();
      } else
        await expect(
          page.getByText("本次核对已结束，请以订单实际状态为准。", {
            exact: true,
          }),
        ).toBeVisible();
      await expect(
        page.getByText("发布操作结果待核对", { exact: true }),
      ).toBeHidden();
      expect(writes).toBe(1);
      expect(cancellations).toBe(0);
      const [saved] = await database.db
        .select()
        .from(database.publicationOrders)
        .where(operators.eq(database.publicationOrders.id, seed.id));
      expect(saved.status).toBe("processing");
      expect(saved.providerAction).toMatchObject({
        id: action.id,
        state: "released",
        resolutionNote: "已核对上游后台，订单尚未取消；本次结束核对",
      });
      const refunds = await database.db
        .select()
        .from(database.balanceTransactions)
        .where(
          operators.and(
            operators.eq(database.balanceTransactions.referenceId, seed.id),
            operators.eq(database.balanceTransactions.operation, "restore"),
          ),
        );
      expect(refunds).toHaveLength(0);
      const audits = await database.db
        .select()
        .from(database.operationLogs)
        .where(
          operators.and(
            operators.eq(database.operationLogs.resourceId, seed.id),
            operators.eq(
              database.operationLogs.operation,
              "publication.order.action.resolved",
            ),
          ),
        );
      expect(audits).toHaveLength(1);
    });
  }

  test("发布服务器执行中记录不能提前结束，超期后明确核对才解除", async ({
    page,
  }) => {
    const seed = await seedPublicationOrder(0, "processing");
    const target = fixture.scopes[0];
    const action = {
      id: randomUUID(),
      operation: "cancel" as const,
      state: "pending" as const,
      actorUserId: fixture.userId,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    };
    await database.db
      .update(database.publicationOrders)
      .set({ providerAction: action })
      .where(operators.eq(database.publicationOrders.id, seed.id));
    await mockBusinessApis(page, (route) => route.continue());
    await page.goto(scopedPath("/dashboard/publication/orders"));
    await page
      .getByRole("button", { name: `核对原操作 ${seed.id}`, exact: true })
      .click();
    await page
      .getByRole("button", { name: "核对订单状态", exact: true })
      .click();
    await page
      .getByLabel("上游核对说明", { exact: true })
      .fill("上游尚无处理记录");
    const finish = page.getByRole("button", {
      name: "已核对，结束本次操作",
      exact: true,
    });
    await expect(finish).toBeDisabled();
    const blocked = await page.request.post(
      `/api/v1/publication-orders/${seed.id}/action-resolution`,
      {
        data: {
          organizationId: target.organizationId,
          teamBindingId: target.teamBindingId,
          brandId: target.brandId,
          actionId: action.id,
          note: "不得提前结束",
        },
      },
    );
    expect(blocked.status()).toBe(409);
    expect((await blocked.json()).error.code).toBe(
      "PUBLICATION_ACTION_IN_PROGRESS",
    );
    await database.db
      .update(database.publicationOrders)
      .set({
        providerAction: {
          ...action,
          expiresAt: new Date(Date.now() - 1).toISOString(),
        },
      })
      .where(operators.eq(database.publicationOrders.id, seed.id));
    await page
      .getByRole("button", { name: "核对订单状态", exact: true })
      .click();
    await expect(finish).toBeEnabled();
    await finish.click();
    await page.getByRole("button", { name: "确认结束", exact: true }).click();
    await expect(
      page.getByText("发布操作结果待核对", { exact: true }),
    ).toBeHidden();
  });

  test("发布订单旧列表允许操作时，服务器阻止重复提交并恢复另一位管理员的原说明", async ({
    page,
  }) => {
    const seed = await seedPublicationOrder(0, "processing");
    const action = {
      id: randomUUID(),
      operation: "appeal" as const,
      state: "uncertain" as const,
      actorUserId: fixture.userId,
      startedAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: new Date(Date.now() - 1).toISOString(),
      reason: 4 as const,
      detail: "另一位管理员提交的原申诉说明",
    };
    const [original] = await database.db
      .select()
      .from(database.publicationOrders)
      .where(operators.eq(database.publicationOrders.id, seed.id));
    await database.db
      .update(database.publicationChannels)
      .set({
        provider: "frog_media",
        providerMediaType: "website",
        providerResourceId: `resource-${seed.id}`,
      })
      .where(operators.eq(database.publicationChannels.id, original.channelId));
    await database.db
      .update(database.publicationOrders)
      .set({ providerOrderId: "upstream", providerAction: action })
      .where(operators.eq(database.publicationOrders.id, seed.id));
    let writes = 0;
    await mockBusinessApis(page, async (route) => {
      writes++;
      await route.continue();
    });
    await page.route("**/api/v1/publication-orders?**", (route) =>
      route.fulfill({
        json: {
          ...envelope([
            {
              order: {
                ...original,
                providerOrderId: "upstream",
                providerAction: null,
              },
              channel,
            },
          ]),
          pagination: { page: 1, pageSize: 20, total: 1, pages: 1 },
        },
      }),
    );
    await page.goto(scopedPath("/dashboard/publication/orders"));
    await page
      .locator("tbody")
      .getByRole("button", { name: /取\s*消/ })
      .click();
    await page.getByRole("button", { name: "确认取消", exact: true }).click();
    await expect(
      page.getByText("发布操作结果待核对", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("具体说明：另一位管理员提交的原申诉说明", { exact: true }),
    ).toBeVisible();
    expect(writes).toBe(1);
    await page.reload();
    await expect(
      page.getByText("具体说明：另一位管理员提交的原申诉说明", { exact: true }),
    ).toBeVisible();
    expect(writes).toBe(1);
    const [saved] = await database.db
      .select()
      .from(database.publicationOrders)
      .where(operators.eq(database.publicationOrders.id, seed.id));
    expect(saved.providerAction?.id).toBe(action.id);
    expect(saved.status).toBe("processing");
  });

  test("提交发布权限变化保留稿件，原页重新检查权限后只提交一次", async ({
    page,
  }) => {
    const target = fixture.scopes[0];
    const writes: Record<string, unknown>[] = [];
    await mockBusinessApis(page, async (route) => {
      if (
        new URL(route.request().url()).pathname !== "/api/v1/publication-orders"
      )
        return route.continue();
      const input = route.request().postDataJSON();
      writes.push(input);
      await fulfill(route, {
        order: {
          id: randomUUID(),
          title: input.title,
          status: "processing",
          priceAmount: 100,
          currency: "CNY",
          resultUrl: null,
        },
        replayed: false,
      });
    });
    await page.goto(
      `${scopedPath("/dashboard/publication/new")}&channelId=${channel.id}`,
    );
    const title = page.getByLabel("内容标题", { exact: true });
    const body = page.getByPlaceholder("粘贴或输入文章正文，段落将自动排版", {
      exact: true,
    });
    await expect(title).toBeEnabled();
    await title.fill("权限恢复后提交的稿件");
    await body.fill("权限变化前尚未提交的正文");
    await page.getByLabel("发布要求", { exact: true }).fill("保留稿件要求");
    const setRole = (role: "brand_admin" | "brand_viewer") =>
      database.db
        .update(database.brandAccess)
        .set({ role })
        .where(
          operators.and(
            operators.eq(database.brandAccess.userId, fixture.userId),
            operators.eq(
              database.brandAccess.organizationId,
              target.organizationId,
            ),
          ),
        );
    await setRole("brand_viewer");
    await page
      .getByRole("button", { name: "刷新品牌范围", exact: true })
      .click();
    await expect(
      page.getByText("当前品牌已没有提交发布权限", { exact: true }),
    ).toBeVisible();
    const submit = page.getByRole("button", { name: /确认并提交发布/ });
    await expect(submit).toBeDisabled();
    await expect(title).toHaveValue("权限恢复后提交的稿件");
    await expect(body).toHaveValue("权限变化前尚未提交的正文");
    const native = await page.request.post("/api/v1/publication-orders", {
      data: {
        organizationId: target.organizationId,
        teamBindingId: target.teamBindingId,
        brandId: target.brandId,
        channelId: channel.id,
        title: "权限恢复后提交的稿件",
        contentHtml: "<p>权限变化前尚未提交的正文</p>",
        note: "保留稿件要求",
        idempotencyKey: randomUUID(),
      },
    });
    expect(native.status()).toBe(403);
    expect(writes).toHaveLength(0);
    await setRole("brand_admin");
    await page
      .getByRole("button", { name: "重新检查权限", exact: true })
      .click();
    await expect(submit).toBeEnabled();
    await expect(title).toHaveValue("权限恢复后提交的稿件");
    await expect(body).toHaveValue("权限变化前尚未提交的正文");
    await submit.click();
    await expect(title).toHaveValue("");
    expect(writes).toHaveLength(1);
    expect(writes[0].title).toBe("权限恢复后提交的稿件");
    expect(writes[0].contentHtml).toBe("<p>权限变化前尚未提交的正文</p>");
    expect(writes[0].note).toBe("保留稿件要求");
  });

  test("发布订单分页搜索、日期与状态恢复，取消后自动回退末页", async ({
    page,
  }) => {
    const seed = await seedPublicationOrder(0, "processing");
    const { db, publicationOrders } = database;
    const { eq } = operators;
    const [first] = await db
      .select()
      .from(publicationOrders)
      .where(eq(publicationOrders.id, seed.id));
    const ids = Array.from({ length: 21 }, () => randomUUID());
    await db.delete(publicationOrders).where(eq(publicationOrders.id, seed.id));
    await db.insert(publicationOrders).values(
      ids.map((id, index) => ({
        id,
        channelId: first.channelId,
        organizationId: first.organizationId,
        brandId: first.brandId,
        status: "processing" as const,
        title: `历史批次文章 ${index}`,
        priceAmount: 0,
        createdBy: fixture.userId,
        idempotencyKey: id,
        createdAt: new Date("2026-09-01T04:00:00Z"),
      })),
    );
    await seedPublicationOrder(0, "published");
    const other = await seedPublicationOrder(1, "published");
    await mockBusinessApis(page, (route) => route.continue());
    await page.goto(scopedPath("/dashboard/publication/orders"));
    await expect(page.getByText("共 22 条订单", { exact: true })).toBeVisible();
    await expect(page.locator("tbody tr.ant-table-row")).toHaveCount(20);
    await page.locator(".ant-pagination-item-2").click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator("tbody tr.ant-table-row")).toHaveCount(2);
    await page.getByLabel("查找订单", { exact: true }).fill("历史批次");
    await page.getByLabel("查找订单", { exact: true }).press("Enter");
    await expect(page).toHaveURL(/keyword=/);
    await expect(page).toHaveURL(/page=1/);
    await expect(page.getByText("共 21 条订单")).toBeVisible();
    await page.getByLabel("订单状态", { exact: true }).click();
    await page
      .locator(".ant-select-dropdown")
      .getByText("发布处理中", { exact: true })
      .click();
    await expect(page).toHaveURL(/status=processing/);
    // The server date contract is also exercised by the real page request.
    const filtered = new URL(page.url());
    filtered.searchParams.set("beginDate", "2026-09-01");
    filtered.searchParams.set("endDate", "2026-09-01");
    filtered.searchParams.set("page", "2");
    await page.goto(filtered.href);
    await expect(page.locator("tbody tr.ant-table-row")).toHaveCount(1);
    await expect(page.getByLabel("提交日期", { exact: true })).toHaveValue(
      "2026-09-01",
    );
    await expect(page.getByLabel("提交结束日期", { exact: true })).toHaveValue(
      "2026-09-01",
    );
    await page.reload();
    await expect(page.getByLabel("查找订单", { exact: true })).toHaveValue(
      "历史批次",
    );
    await expect(page.locator("tbody tr.ant-table-row")).toHaveCount(1);
    await page.getByRole("button", { name: /取\s*消/ }).click();
    await page.getByRole("button", { name: "确认取消", exact: true }).click();
    await expect(page.getByText("共 20 条订单")).toBeVisible();
    await expect(page).toHaveURL(/page=1/);
    await expect(page.locator("tbody tr.ant-table-row")).toHaveCount(20);
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await expect(page.getByText("共 22 条订单", { exact: true })).toBeVisible();
    await page.getByLabel("查找订单", { exact: true }).fill(ids[0]);
    await page.getByLabel("查找订单", { exact: true }).press("Enter");
    await expect(page.getByText("共 1 条订单")).toBeVisible();
    await page
      .getByRole("combobox", { name: "企业", exact: true })
      .press("ArrowDown");
    await page
      .locator(".ant-select-dropdown")
      .getByText(fixture.scopes[1].name, { exact: true })
      .click();
    await expect(page.getByText(other.title, { exact: true })).toBeVisible();
    await expect(page.getByLabel("查找订单", { exact: true })).toHaveValue("");
    await expect(
      page.getByText("历史批次文章 0", { exact: true }),
    ).toBeHidden();
  });

  test("发布订单失败可重试，筛选空态在明暗主题和各宽度可访问", async ({
    page,
  }) => {
    await seedPublicationOrder();
    await mockBusinessApis(page);
    let failing = true;
    await page.route("**/api/v1/publication-orders?**", async (route) => {
      if (!failing) return route.continue();
      return route.fulfill({
        status: 503,
        json: { error: { message: "订单暂时不可用" } },
      });
    });
    await page.goto(scopedPath("/dashboard/publication/orders"));
    await expect(
      page.getByText("订单暂时不可用", { exact: true }),
    ).toBeVisible();
    failing = false;
    await page.getByRole("button", { name: /重\s*试/ }).click();
    await expect(page.getByText("共 1 条订单", { exact: true })).toBeVisible();
    await page.getByLabel("查找订单", { exact: true }).fill("不存在的订单");
    await page.getByLabel("查找订单", { exact: true }).press("Enter");
    await expect(
      page.getByText("没有符合筛选条件的订单", { exact: true }),
    ).toBeVisible();
    for (const theme of ["light", "dark"]) {
      if (theme === "dark")
        await page.getByRole("button", { name: "切换亮暗色模式" }).click();
      await expect
        .poll(() => page.locator("html").getAttribute("data-theme"))
        .toBe(theme);
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBeTruthy();
        await page.evaluate(async () => {
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.effect?.getComputedTiming().iterations !== Infinity,
              )
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        await page.evaluate(axe.source);
        const result = await page.evaluate(async () =>
          (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          }),
        );
        expect(result.violations).toEqual([]);
      }
    }
    // Reapplying unchanged filters must keep the successful snapshot.
    await page.getByLabel("查找订单", { exact: true }).press("Enter");
    await expect(
      page.getByText("没有符合筛选条件的订单", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await expect(page.getByText("共 1 条订单", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await expect(page.getByText("共 1 条订单", { exact: true })).toBeVisible();
  });

  test("已发布订单一键带入追踪，来源实时校验范围与状态，读取不提交", async ({
    page,
  }) => {
    const published = await seedPublicationOrder();
    const processing = await seedPublicationOrder(0, "processing");
    const posts: { key: string; input: Record<string, unknown> }[] = [];
    await mockBusinessApis(page, async (route) => {
      const input = route.request().postDataJSON();
      const key = route.request().headers()["idempotency-key"];
      posts.push({ key, input });
      await fulfill(route, {
        id: randomUUID(),
        idempotencyKey: key,
        input,
        status: "succeeded",
        articleId: "publication-tracked",
        points: input.expectedPoints,
        refunded: false,
        errorCode: null,
        replayed: false,
        createdAt: new Date().toISOString(),
      });
    });
    await page.route("**/api/v1/answerbit/articles?**", (route) =>
      fulfill(route, { list: [], total: 0, scroll_id: "" }),
    );
    const sourceUrl = (id: string, index = 0) =>
      `/api/v1/publication-orders/${id}/tracking-source?${new URLSearchParams({
        organizationId: fixture.scopes[index].organizationId,
        teamBindingId: fixture.scopes[index].teamBindingId,
        brandId: fixture.scopes[index].brandId,
      })}`;
    expect((await page.request.get(sourceUrl(published.id, 1))).status()).toBe(
      404,
    );
    expect((await page.request.get(sourceUrl(processing.id))).status()).toBe(
      409,
    );
    expect((await page.request.get(sourceUrl("invalid"))).status()).toBe(400);
    const { eq } = operators;
    await database.db
      .update(database.publicationOrders)
      .set({ resultUrl: "ftp://example.com/file" })
      .where(eq(database.publicationOrders.id, published.id));
    expect((await page.request.get(sourceUrl(published.id))).status()).toBe(
      422,
    );
    await database.db
      .update(database.publicationOrders)
      .set({ resultUrl: published.url })
      .where(eq(database.publicationOrders.id, published.id));
    await page.goto(scopedPath("/dashboard/publication/orders"));
    await expect(page.getByText("已发布", { exact: true })).toBeVisible();
    await expect(page.getByText("发布处理中", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "加入效果追踪", exact: true }),
    ).toHaveCount(1);
    await page.getByRole("link", { name: "加入效果追踪", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "新增文章追踪" });
    await expect(dialog.getByLabel("文章标题", { exact: true })).toHaveValue(
      published.title,
    );
    await expect(dialog.getByLabel("发布链接", { exact: true })).toHaveValue(
      published.url,
    );
    expect(new URL(page.url()).searchParams.get("organizationId")).toBe(
      fixture.scopes[0].organizationId,
    );
    expect(new URL(page.url()).searchParams.get("brandId")).toBe(
      fixture.scopes[0].brandId,
    );
    expect(posts).toHaveLength(0);
    await dialog.getByRole("button", { name: /取\s*消/ }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await page
      .getByRole("button", { name: "新增文章追踪", exact: true })
      .click();
    await expect(dialog.getByLabel("文章标题", { exact: true })).toHaveValue(
      published.title,
    );
    await dialog.getByRole("button", { name: /加入追踪/ }).click();
    await expect(
      page.getByText("文章已加入追踪", { exact: true }),
    ).toBeVisible();
    expect(posts).toHaveLength(1);
    expect(posts[0].input).toMatchObject({
      title: published.title,
      urls: [published.url],
      brandId: fixture.scopes[0].brandId,
    });
    await database.db
      .update(database.brandAccess)
      .set({ role: "brand_viewer" })
      .where(eq(database.brandAccess.userId, fixture.userId));
    expect((await page.request.get(sourceUrl(published.id))).status()).toBe(
      403,
    );
  });

  test("发布来源保留已有草稿并阻止覆盖待确认追踪，明暗主题与各宽度可用", async ({
    page,
  }) => {
    const published = await seedPublicationOrder();
    const another = await seedPublicationOrder();
    const attempts: { key: string; input: Record<string, unknown> }[] = [];
    await mockBusinessApis(page, async (route) => {
      const input = route.request().postDataJSON(),
        key = route.request().headers()["idempotency-key"];
      attempts.push({ key, input });
      await fulfill(route, {
        id: "uncertain-tracking",
        idempotencyKey: key,
        input,
        status: "uncertain",
        articleId: null,
        points: input.expectedPoints,
        refunded: true,
        errorCode: "ARTICLE_TRACKING_UNCERTAIN",
        replayed: attempts.length > 1,
        createdAt: new Date().toISOString(),
      });
    });
    await page.route("**/api/v1/answerbit/articles?**", (route) =>
      fulfill(route, { list: [], total: 0, scroll_id: "" }),
    );
    await page.goto(`${scopedPath("/dashboard/content")}&stage=trace`);
    await page
      .getByRole("button", { name: "新增文章追踪", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "新增文章追踪" });
    await dialog.getByLabel("文章标题", { exact: true }).fill("原来的追踪草稿");
    await dialog
      .getByLabel("发布链接", { exact: true })
      .fill("https://example.com/original");
    await dialog.getByRole("button", { name: /取\s*消/ }).click();
    await expect(dialog).toBeHidden();
    const handoff = (id: string) =>
      `${scopedPath("/dashboard/content")}&stage=trace&publicationOrderId=${id}`;
    await page.goto(handoff(published.id));
    await expect(
      page.getByText("已发布内容待追踪", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "继续编辑原草稿", exact: true })
      .click();
    await expect(dialog.getByLabel("文章标题", { exact: true })).toHaveValue(
      "原来的追踪草稿",
    );
    await dialog.getByRole("button", { name: /取\s*消/ }).click();
    await expect(dialog).toBeHidden();
    for (const theme of ["light", "dark"]) {
      if (theme === "dark")
        await page.getByRole("button", { name: "切换亮暗色模式" }).click();
      await expect
        .poll(() => page.locator("html").getAttribute("data-theme"))
        .toBe(theme);
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect(
          page.getByRole("button", { name: "使用发布内容", exact: true }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBeTruthy();
        await page.evaluate(async () => {
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.effect?.getComputedTiming().iterations !== Infinity,
              )
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        await page.evaluate(axe.source);
        expect(
          (
            await page.evaluate(async () =>
              (window as unknown as { axe: typeof axe }).axe.run(document, {
                runOnly: {
                  type: "tag",
                  values: ["wcag2a", "wcag2aa", "wcag21aa"],
                },
              }),
            )
          ).violations,
        ).toEqual([]);
      }
    }
    await page
      .getByRole("button", { name: "使用发布内容", exact: true })
      .click();
    await page.getByRole("button", { name: "保留草稿", exact: true }).click();
    await page
      .getByRole("button", { name: "继续编辑原草稿", exact: true })
      .click();
    await expect(dialog.getByLabel("文章标题", { exact: true })).toHaveValue(
      "原来的追踪草稿",
    );
    await dialog.getByRole("button", { name: /取\s*消/ }).click();
    await expect(dialog).toBeHidden();
    await page
      .getByRole("button", { name: "使用发布内容", exact: true })
      .click();
    await page
      .getByRole("button", { name: "使用发布内容", exact: true })
      .last()
      .click();
    await expect(dialog.getByLabel("文章标题", { exact: true })).toHaveValue(
      published.title,
    );
    await expect(dialog.getByLabel("发布链接", { exact: true })).toHaveValue(
      published.url,
    );
    expect(attempts).toHaveLength(0);
    await dialog.getByRole("button", { name: /加入追踪/ }).click();
    await expect(
      dialog.getByText("追踪结果需要核对，积分已返还", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: /取\s*消/ }).click();
    await expect(dialog).toBeHidden();
    await page.goto(handoff(another.id));
    await expect(page.getByText(another.title, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "使用发布内容", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "先确认已有提交", exact: true })
      .click();
    await expect(dialog.getByLabel("文章标题", { exact: true })).toHaveValue(
      published.title,
    );
    await dialog.getByRole("button", { name: /确认上次追踪/ }).click();
    await expect(
      dialog.getByText("追踪结果需要核对，积分已返还", { exact: true }),
    ).toBeVisible();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    await dialog.getByRole("button", { name: /取\s*消/ }).click();
    await expect(dialog).toBeHidden();
    let releaseSource!: () => void;
    const delayedSource = new Promise<void>(
      (resolve) => (releaseSource = resolve),
    );
    let sourceRequested = false;
    await page.route(
      `**/api/v1/publication-orders/${another.id}/tracking-source?**`,
      async (route) => {
        sourceRequested = true;
        await delayedSource;
        await fulfill(route, {
          orderId: another.id,
          title: another.title,
          url: another.url,
        });
      },
    );
    await page.goto(handoff(another.id));
    await expect.poll(() => sourceRequested).toBe(true);
    await page.locator("#answerbit-scope-organization").focus();
    await page.locator("#answerbit-scope-organization").press("ArrowDown");
    await page.getByTitle("流程测试企业 B", { exact: true }).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.has("publicationOrderId"))
      .toBe(false);
    await expect(
      page.getByText("已发布内容待追踪", { exact: true }),
    ).toHaveCount(0);
    releaseSource();
    await page
      .getByRole("button", { name: "新增文章追踪", exact: true })
      .click();
    await expect(dialog.getByLabel("文章标题", { exact: true })).toHaveValue(
      "",
    );
    await expect(dialog.getByLabel("发布链接", { exact: true })).toHaveValue(
      "",
    );
    expect(attempts).toHaveLength(2);
  });

  test("追踪语言与生成独立，响应丢失后刷新确认原请求，跨企业保留各自输入", async ({
    page,
  }) => {
    const submitted: { key: string; input: Record<string, unknown> }[] = [];
    const saved = new Map<string, Record<string, unknown>>();
    await mockBusinessApis(page, async (route) => {
      const key = route.request().headers()["idempotency-key"],
        input = route.request().postDataJSON();
      submitted.push({ key, input });
      const existing = saved.get(key);
      const record = existing ?? {
        id: randomUUID(),
        idempotencyKey: key,
        input,
        status: "succeeded",
        articleId: "tracked-article",
        points: input.expectedPoints,
        refunded: false,
        errorCode: null,
        createdAt: new Date().toISOString(),
      };
      saved.set(key, record);
      if (submitted.length === 1) return route.abort("failed");
      return fulfill(route, { ...record, replayed: Boolean(existing) });
    });
    await page.route(
      "**/api/v1/answerbit/article-tracking-submissions?**",
      (route) =>
        fulfill(
          route,
          [...saved.values()].filter(
            (record) =>
              (record.input as Record<string, unknown>).brandId ===
              new URL(route.request().url()).searchParams.get("brandId"),
          ),
        ),
    );
    await page.route("**/api/v1/answerbit/articles?**", (route) =>
      fulfill(route, { list: [], total: 0, scroll_id: "" }),
    );
    await page.goto(`${scopedPath("/dashboard/content")}&stage=generate`);
    await expect(page.getByLabel("语言", { exact: true })).toBeEnabled();
    await page.getByLabel("语言", { exact: true }).focus();
    await page.getByLabel("语言", { exact: true }).press("ArrowDown");
    await page.getByTitle("English (US)", { exact: true }).click();
    await page.getByRole("tab", { name: /效果追踪/ }).click();
    await page
      .getByRole("button", { name: "新增文章追踪", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "新增文章追踪" });
    await expect(dialog.getByText("简体中文", { exact: true })).toBeVisible();
    await dialog
      .getByLabel("文章标题", { exact: true })
      .fill("企业 A 的原追踪");
    await dialog
      .getByLabel("发布链接", { exact: true })
      .fill("https://example.com/a\nhttps://example.com/a");
    await dialog.getByLabel("语言", { exact: true }).focus();
    await dialog.getByLabel("语言", { exact: true }).press("ArrowDown");
    await page.getByTitle("日本語", { exact: true }).click();
    await dialog.getByRole("button", { name: /加入追踪/ }).click();
    await expect(
      page.getByText("Failed to fetch", { exact: true }),
    ).toBeVisible();
    await dialog
      .getByLabel("文章标题", { exact: true })
      .fill("企业 A 的后续输入");
    await page.reload();
    await page.getByRole("button", { name: "继续确认", exact: true }).click();
    await expect(dialog.getByLabel("文章标题", { exact: true })).toHaveValue(
      "企业 A 的后续输入",
    );
    await dialog.getByRole("button", { name: /确认上次追踪/ }).click();
    await expect(
      page.getByText("追踪已确认，后续输入已保留。", { exact: true }),
    ).toBeVisible();
    expect(submitted).toHaveLength(2);
    expect(submitted[1]).toEqual(submitted[0]);
    expect(saved.size).toBe(1);
    expect(submitted[0].input).toMatchObject({
      language: "ja-JP",
      urls: ["https://example.com/a"],
    });
    await dialog.getByRole("button", { name: /取\s*消/ }).click();
    await expect(dialog).toBeHidden();
    await page.locator("#answerbit-scope-organization").focus();
    await page.locator("#answerbit-scope-organization").press("ArrowDown");
    await page.getByTitle("流程测试企业 B", { exact: true }).click();
    await page
      .getByRole("button", { name: "新增文章追踪", exact: true })
      .click();
    await expect(dialog.getByLabel("文章标题", { exact: true })).toHaveValue(
      "",
    );
    await expect(dialog.getByText("简体中文", { exact: true })).toBeVisible();
    await dialog.getByLabel("文章标题", { exact: true }).fill("企业 B 的输入");
    await dialog.getByRole("button", { name: /取\s*消/ }).click();
    await expect(dialog).toBeHidden();
    await page.locator("#answerbit-scope-organization").focus();
    await page.locator("#answerbit-scope-organization").press("ArrowDown");
    await page.getByTitle("流程测试企业 A", { exact: true }).click();
    await page
      .getByRole("button", { name: "新增文章追踪", exact: true })
      .click();
    await expect(dialog.getByLabel("文章标题", { exact: true })).toHaveValue(
      "企业 A 的后续输入",
    );
    await expect(dialog.getByText("日本語", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: /取\s*消/ }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("tab", { name: "AI 生成", exact: true }).click();
    await expect(page.getByText("English (US)", { exact: true })).toBeVisible();
  });

  test("追踪结果不确定保留原提交，核对后才能明确发起新提交，明暗主题可访问", async ({
    page,
  }) => {
    const attempts: { key: string; input: unknown }[] = [];
    let original: Record<string, unknown>;
    await mockBusinessApis(page, async (route) => {
      const key = route.request().headers()["idempotency-key"],
        input = route.request().postDataJSON();
      attempts.push({ key, input });
      if (!original)
        original = {
          id: randomUUID(),
          idempotencyKey: key,
          input,
          status: "uncertain",
          articleId: null,
          points: input.expectedPoints,
          refunded: true,
          errorCode: "ARTICLE_TRACKING_UNCERTAIN",
          createdAt: new Date().toISOString(),
        };
      return fulfill(
        route,
        key === original.idempotencyKey
          ? { ...original, replayed: attempts.length > 1 }
          : {
              ...original,
              id: randomUUID(),
              idempotencyKey: key,
              input,
              status: "succeeded",
              articleId: "new-article",
              refunded: false,
              replayed: false,
            },
      );
    });
    await page.addInitScript({ content: axe.source });
    await page.route("**/api/v1/answerbit/articles?**", (route) =>
      fulfill(route, { list: [], total: 0, scroll_id: "" }),
    );
    await page.route(
      "**/api/v1/answerbit/article-tracking-submissions?**",
      (route) => fulfill(route, original ? [original] : []),
    );
    await page.goto(`${scopedPath("/dashboard/content")}&stage=tracking`);
    await page
      .getByRole("button", { name: "新增文章追踪", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "新增文章追踪" });
    await dialog.getByLabel("文章标题", { exact: true }).fill("待核对追踪");
    await dialog
      .getByLabel("发布链接", { exact: true })
      .fill("https://example.com/uncertain");
    await dialog.getByRole("button", { name: /加入追踪/ }).click();
    await expect(
      dialog.getByText("追踪结果需要核对，积分已返还", { exact: true }),
    ).toBeVisible();
    await dialog.getByLabel("文章标题", { exact: true }).fill("之后修改的追踪");
    await page.reload();
    await page.getByRole("button", { name: "继续确认", exact: true }).click();
    await dialog.getByRole("button", { name: /确认上次追踪/ }).click();
    await expect(
      dialog.getByText("追踪结果需要核对，积分已返还", { exact: true }),
    ).toBeVisible();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    for (const theme of ["light", "dark"]) {
      if (theme === "dark")
        await page.evaluate(() =>
          document
            .querySelector<HTMLButtonElement>('[aria-label="切换亮暗色模式"]')!
            .click(),
        );
      await expect
        .poll(() => page.locator("html").getAttribute("data-theme"))
        .toBe(theme);
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.effect?.getComputedTiming().iterations !== Infinity,
            )
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      const violations = await page.evaluate(async () =>
        (
          await (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: {
              type: "tag",
              values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
            },
          })
        ).violations.map(({ id, nodes }) => ({
          id,
          nodes: nodes.map((node) => node.html),
        })),
      );
      expect(violations).toEqual([]);
    }
    await dialog
      .getByRole("button", { name: "已核对，结束本次确认", exact: true })
      .click();
    await page.getByRole("button", { name: /确\s*定/ }).click();
    await expect(dialog.getByLabel("文章标题", { exact: true })).toHaveValue(
      "之后修改的追踪",
    );
    await dialog.getByRole("button", { name: /加入追踪/ }).click();
    await expect(
      page.getByText("文章已加入追踪", { exact: true }),
    ).toBeVisible();
    expect(attempts).toHaveLength(3);
    expect(attempts[2].key).not.toBe(attempts[0].key);
  });

  test("追踪详情切换企业及重新选择文章时忽略迟到内容", async ({ page }) => {
    await mockBusinessApis(page);
    let releaseOld!: () => void, releaseSlow!: () => void;
    const old = new Promise<void>((resolve) => (releaseOld = resolve)),
      slow = new Promise<void>((resolve) => (releaseSlow = resolve));
    const requested = new Set<string>();
    await page.route("**/api/v1/answerbit/articles?**", (route) => {
      const scope = fixture.scopes.find(
        (item) =>
          item.brandId ===
          new URL(route.request().url()).searchParams.get("brandId"),
      )!;
      return fulfill(route, {
        list: ["慢文章", "快文章"].map((title, index) => ({
          id: `${scope.brandId}-${index}`,
          title: `${scope.name} ${title}`,
          status: 3,
          source: 2,
          template_type: 0,
          ref_count: 0,
          fluctuation: 0,
          ref_trends: [],
          published_platforms: [],
        })),
        total: 2,
        scroll_id: "",
      });
    });
    await page.route("**/api/v1/answerbit/articles/*?**", async (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
      requested.add(id);
      if (id.startsWith(fixture.scopes[0].brandId)) await old;
      else if (id.endsWith("-0")) await slow;
      await fulfill(route, {
        trace_info: [],
        stats: {
          total_count: id.endsWith("-0") ? 99 : 7,
          ref_count_increase: 0,
          ref_count: {},
          ref_trends: [],
        },
      }).catch(() => {});
    });
    await page.goto(`${scopedPath("/dashboard/content")}&stage=tracking`);
    await page
      .getByRole("row")
      .filter({ hasText: "流程测试企业 A 慢文章" })
      .getByRole("button", { name: "详情" })
      .click();
    await expect.poll(() => requested.size).toBe(1);
    await page.locator("#answerbit-scope-organization").focus();
    await page.locator("#answerbit-scope-organization").press("ArrowDown");
    await page.getByTitle("流程测试企业 B", { exact: true }).click();
    releaseOld();
    await expect(
      page.getByText("流程测试企业 B 慢文章", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("文章引用表现", { exact: true })).toHaveCount(
      0,
    );
    await page
      .getByRole("row")
      .filter({ hasText: "流程测试企业 B 慢文章" })
      .getByRole("button", { name: "详情" })
      .click();
    await expect.poll(() => requested.size).toBe(2);
    await page
      .getByRole("row")
      .filter({ hasText: "流程测试企业 B 快文章" })
      .getByRole("button", { name: "详情" })
      .click();
    await expect(page.getByText("文章引用表现", { exact: true })).toBeVisible();
    releaseSlow();
    await expect(
      page.getByRole("dialog").getByText("7", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog").getByText("99", { exact: true }),
    ).toHaveCount(0);
  });

  test("企业目录按 BrandID 查找并恢复筛选页码，冻结末页后回退，服务与积分到期分别显示", async ({
    page,
  }) => {
    await makePlatformAdministrator();
    await mockAdminReads(page);
    const {
      db,
      organizations,
      answerbitConnections,
      answerbitTeamBindings,
      answerbitBrandMappings,
    } = database;
    const { eq } = operators;
    const marker = `目录-${randomUUID().slice(0, 8)}`;
    const fixedTime = new Date("2026-01-01T00:00:00Z");
    const future = new Date("2038-01-01T00:00:00Z"),
      past = new Date("2020-01-01T00:00:00Z");
    const batch: typeof fixture.scopes = [];
    for (let index = 0; index < 21; index++) {
      const organizationId = randomUUID(),
        teamBindingId = randomUUID(),
        brandId = `${marker}-brand-${index}-${randomUUID().slice(0, 8)}`,
        name = `${marker}企业 ${index}`;
      await db.insert(organizations).values({
        id: organizationId,
        name,
        slug: organizationId,
        serviceExpiresAt: future,
        pointsExpiresAt: future,
        createdAt: fixedTime,
      });
      const [connection] = await db
        .insert(answerbitConnections)
        .values({
          organizationId,
          encryptedApiKey: "qa-unused",
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
        teamId: "qa-team",
        status: "active",
      });
      await db
        .insert(answerbitBrandMappings)
        .values({ organizationId, teamBindingId, brandId, brandName: name });
      const scope = { organizationId, teamBindingId, brandId, name };
      batch.push(scope);
      fixture.scopes.push(scope);
    }
    const target = [...batch].sort((a, b) =>
      a.organizationId.localeCompare(b.organizationId),
    )[0];
    await db
      .update(organizations)
      .set({ pointsExpiresAt: past })
      .where(eq(organizations.id, target.organizationId));
    await db
      .update(organizations)
      .set({
        name: `${marker}服务到期`,
        serviceExpiresAt: past,
        pointsExpiresAt: future,
      })
      .where(eq(organizations.id, fixture.scopes[0].organizationId));
    await db
      .update(organizations)
      .set({
        name: `${marker}手动冻结`,
        status: "suspended",
        serviceExpiresAt: future,
        pointsExpiresAt: future,
      })
      .where(eq(organizations.id, fixture.scopes[1].organizationId));
    await page.goto(
      `/admin?section=organizations&orgKeyword=${encodeURIComponent(marker)}&orgAccessState=active&orgPage=3&orgPageSize=10`,
    );
    const targetRow = page.locator("tr").filter({ hasText: target.brandId });
    await expect(targetRow).toBeVisible();
    await expect(targetRow.getByText("正常", { exact: true })).toBeVisible();
    await expect(
      targetRow.getByText("积分已到期", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("共 21 家腾讯企业", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".ant-pagination-item-active")).toHaveAttribute(
      "title",
      "3",
    );
    for (const selectedTheme of ["light", "dark"]) {
      if (
        (await page.locator("html").getAttribute("data-theme")) !==
        selectedTheme
      )
        await page.getByRole("button", { name: "切换亮暗色模式" }).click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        selectedTheme,
      );
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBeTruthy();
        await page.evaluate(async () => {
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.effect?.getComputedTiming().iterations !== Infinity,
              )
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        await page.evaluate(axe.source);
        const scan = await page.evaluate(() =>
          (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          }),
        );
        expect(scan.violations.map(({ id }) => id)).toEqual([]);
        if (width === 390)
          await page.screenshot({
            path: test
              .info()
              .outputPath(`enterprise-directory-expiry-${selectedTheme}.png`),
          });
      }
    }
    await page.reload();
    await expect(targetRow).toBeVisible();
    await expect(page.locator(".ant-pagination-item-active")).toHaveAttribute(
      "title",
      "3",
    );
    await page
      .getByLabel("搜索企业或品牌", { exact: true })
      .fill(target.brandId);
    await page.getByLabel("搜索企业或品牌", { exact: true }).press("Enter");
    await expect(
      page.getByText("共 1 家腾讯企业", { exact: true }),
    ).toBeVisible();
    await expect(targetRow).toBeVisible();
    await page.reload();
    await expect(
      page.getByLabel("搜索企业或品牌", { exact: true }),
    ).toHaveValue(target.brandId);
    await expect(
      page.getByText("共 1 家腾讯企业", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("搜索企业或品牌", { exact: true }).fill(marker);
    await page.getByLabel("搜索企业或品牌", { exact: true }).press("Enter");
    await expect(
      page.getByText("共 21 家腾讯企业", { exact: true }),
    ).toBeVisible();
    await page.locator(".ant-pagination-item-3").click();
    await expect(targetRow).toBeVisible();
    await page.getByRole("menuitem", { name: /客户与代理/ }).click();
    await page.getByRole("menuitem", { name: /企业与品牌/ }).click();
    await expect(targetRow).toBeVisible();
    await expect(page.locator(".ant-pagination-item-active")).toHaveAttribute(
      "title",
      "3",
    );
    await targetRow
      .getByRole("button", { name: `冻结企业 ${target.name}`, exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "冻结此企业？" })
      .getByRole("button", { name: "确认冻结", exact: true })
      .click();
    await expect(page).toHaveURL(/orgPage=2/);
    await expect(
      page.getByText("共 20 家腾讯企业", { exact: true }),
    ).toBeVisible();
    await expect(targetRow).not.toBeVisible();
    const setState = async (label: string) => {
      await page
        .getByRole("combobox", { name: "筛选企业状态", exact: true })
        .press("ArrowDown");
      await page
        .locator(".ant-select-item-option")
        .filter({ hasText: new RegExp(`^${label}$`) })
        .click();
    };
    await setState("到期冻结");
    await expect(
      page.getByText("共 1 家腾讯企业", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator("tr")
        .filter({ hasText: fixture.scopes[0].brandId })
        .getByText("到期冻结", { exact: true }),
    ).toBeVisible();
    await setState("手动冻结");
    await expect(
      page.getByText("共 2 家腾讯企业", { exact: true }),
    ).toBeVisible();
    await targetRow
      .getByRole("button", { name: `恢复企业 ${target.name}`, exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "恢复此企业？" })
      .getByRole("button", { name: "确认恢复", exact: true })
      .click();
    await expect(
      page.getByText("共 1 家腾讯企业", { exact: true }),
    ).toBeVisible();
    await expect(targetRow).not.toBeVisible();
    await setState("正常");
    await expect(
      page.getByText("共 21 家腾讯企业", { exact: true }),
    ).toBeVisible();
    const lastPage = await page.request.get(
      `/api/v1/admin/organizations?q=${encodeURIComponent(marker)}&accessState=active&page=999&pageSize=10`,
    );
    expect(lastPage.ok()).toBeTruthy();
    expect((await lastPage.json()).data.pagination).toMatchObject({
      page: 3,
      total: 21,
    });
    const invalid = await page.request.get(
      "/api/v1/admin/organizations?accessState=unknown",
    );
    expect(invalid.status()).toBe(400);
  });

  test("企业目录新条件隐藏旧企业，迟到搜索不覆盖，读取失败只重试当前条件，明暗主题与各宽度可访问", async ({
    page,
  }) => {
    await makePlatformAdministrator();
    await mockAdminReads(page);
    const first = fixture.scopes[0],
      second = fixture.scopes[1];
    let holdFirst = false,
      readsFail = false,
      writes = 0;
    let release!: () => void, announce!: () => void, complete!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const announced = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const completed = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /hydration|validateDOMNesting|duplicate|Warning:/i.test(message.text())
      )
        runtimeErrors.push(message.text());
    });
    await page.route("**/api/v1/admin/organizations?**", async (route) => {
      if (route.request().method() !== "GET") {
        writes++;
        return route.continue();
      }
      const q = new URL(route.request().url()).searchParams.get("q");
      if (readsFail)
        return route.fulfill({
          status: 503,
          json: { error: { message: "企业目录临时读取失败" } },
        });
      if (holdFirst && q === first.brandId) {
        const response = await route.fetch();
        expect(response.ok()).toBeTruthy();
        announce();
        await gate;
        try {
          await route.fulfill({ response });
        } finally {
          complete();
        }
        return;
      }
      return route.continue();
    });
    await page.goto("/admin?section=organizations");
    await expect(
      page.locator("tr").filter({ hasText: first.brandId }),
    ).toBeVisible();
    holdFirst = true;
    await page
      .getByLabel("搜索企业或品牌", { exact: true })
      .fill(first.brandId);
    await page.getByLabel("搜索企业或品牌", { exact: true }).press("Enter");
    try {
      await announced;
      await expect(
        page.locator("tr").filter({ hasText: second.brandId }),
      ).not.toBeVisible();
      await page
        .getByLabel("搜索企业或品牌", { exact: true })
        .fill(second.brandId);
      await page.getByLabel("搜索企业或品牌", { exact: true }).press("Enter");
      await expect(
        page.locator("tr").filter({ hasText: second.brandId }),
      ).toBeVisible();
      release();
      await completed;
      await expect(
        page.locator("tr").filter({ hasText: first.brandId }),
      ).not.toBeVisible();
      await expect(
        page.getByText("共 1 家腾讯企业", { exact: true }),
      ).toBeVisible();
    } finally {
      release();
    }
    readsFail = true;
    await page
      .getByRole("button", { name: "刷新当前模块", exact: true })
      .click();
    await expect(
      page.getByText("企业目录读取失败", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("tr").filter({ hasText: second.brandId }),
    ).not.toBeVisible();
    await expect(
      page.getByLabel("搜索企业或品牌", { exact: true }),
    ).toHaveValue(second.brandId);
    for (const selectedTheme of ["light", "dark"]) {
      if (
        (await page.locator("html").getAttribute("data-theme")) !==
        selectedTheme
      )
        await page.getByRole("button", { name: "切换亮暗色模式" }).click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        selectedTheme,
      );
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBeTruthy();
        await page.evaluate(async () => {
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.effect?.getComputedTiming().iterations !== Infinity,
              )
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        await page.evaluate(axe.source);
        const scan = await page.evaluate(() =>
          (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          }),
        );
        expect(scan.violations.map(({ id }) => id)).toEqual([]);
        if (width === 390)
          await page.screenshot({
            path: test
              .info()
              .outputPath(`enterprise-directory-error-${selectedTheme}.png`),
          });
      }
    }
    readsFail = false;
    await page
      .getByRole("button", { name: "重试读取企业目录", exact: true })
      .click();
    await expect(
      page.locator("tr").filter({ hasText: second.brandId }),
    ).toBeVisible();
    await page
      .getByLabel("搜索企业或品牌", { exact: true })
      .fill(`missing-${randomUUID()}`);
    await page.getByLabel("搜索企业或品牌", { exact: true }).press("Enter");
    await expect(
      page.getByText("没有符合条件的企业", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "重置筛选", exact: true }).click();
    await expect(
      page.locator("tr").filter({ hasText: first.brandId }),
    ).toBeVisible();
    await expect(
      page.locator("tr").filter({ hasText: second.brandId }),
    ).toBeVisible();
    // Opening and switching the existing asset form must not pre-render a portal during SSR.
    const uniqueName = `目录表单-${randomUUID().slice(0, 8)}`;
    await database.db
      .update(database.organizations)
      .set({ name: uniqueName })
      .where(operators.eq(database.organizations.id, first.organizationId));
    await page.getByRole("menuitem", { name: /资产与计费/ }).click();
    const assetRow = page.locator("tr").filter({ hasText: uniqueName });
    await assetRow
      .getByRole("button", { name: "入账 / 扣减", exact: true })
      .click();
    const assetForm = page.getByRole("dialog", {
      name: `${uniqueName} · 资产调整`,
      exact: true,
    });
    await expect(
      assetForm.getByRole("radio", { name: "入账", exact: true }),
    ).toBeChecked();
    await expect(
      assetForm.getByRole("button", { name: "确认入账", exact: true }),
    ).toBeVisible();
    await assetForm
      .getByRole("radio", { name: "手动扣减", exact: true })
      .click();
    await expect(
      assetForm.getByRole("radio", { name: "企业资金池", exact: true }),
    ).toBeChecked();
    await expect(
      assetForm.getByRole("button", { name: "确认手动扣减", exact: true }),
    ).toBeVisible();
    await assetForm.getByLabel("数量", { exact: true }).fill("17");
    await page.keyboard.press("Escape");
    await expect(assetForm).not.toBeVisible();
    await assetRow
      .getByRole("button", { name: "入账 / 扣减", exact: true })
      .click();
    await expect(
      assetForm.getByRole("radio", { name: "入账", exact: true }),
    ).toBeChecked();
    await expect(assetForm.getByLabel("数量", { exact: true })).toHaveValue("");
    await page.keyboard.press("Escape");
    expect(writes).toBe(0);
    expect(runtimeErrors).toEqual([]);
  });

  test("资产目录超过百家仍可定位，企业和品牌余额分开，查看流水恢复范围并远程搜索用户", async ({
    page,
  }) => {
    await makePlatformAdministrator();
    await mockAdminReads(page);
    const marker = `资金-${randomUUID().slice(0, 8)}`,
      past = new Date("2020-01-01"),
      future = new Date("2038-01-01");
    const batch = Array.from({ length: 105 }, (_, index) => ({
      organizationId: randomUUID(),
      connectionId: randomUUID(),
      teamBindingId: randomUUID(),
      brandId: `${marker}-brand-${index}-${randomUUID().slice(0, 8)}`,
      name: `${marker}企业${index}`,
    }));
    await database.db.insert(database.organizations).values(
      batch.map((row) => ({
        id: row.organizationId,
        name: row.name,
        slug: row.organizationId,
        createdAt: past,
        serviceExpiresAt: future,
        pointsExpiresAt: future,
      })),
    );
    await database.db.insert(database.answerbitConnections).values(
      batch.map((row) => ({
        id: row.connectionId,
        organizationId: row.organizationId,
        encryptedApiKey: "qa-unused",
        apiKeyFingerprint: randomUUID(),
        apiKeyHint: "qa",
        managedByPlatform: true,
        createdBy: fixture.userId,
      })),
    );
    await database.db.insert(database.answerbitTeamBindings).values(
      batch.map((row) => ({
        id: row.teamBindingId,
        organizationId: row.organizationId,
        connectionId: row.connectionId,
        teamId: "qa-team",
        status: "active" as const,
      })),
    );
    await database.db.insert(database.answerbitBrandMappings).values(
      batch.map((row) => ({
        organizationId: row.organizationId,
        teamBindingId: row.teamBindingId,
        brandId: row.brandId,
        brandName: row.name,
      })),
    );
    fixture.scopes.push(...batch);
    const target = [...batch].sort((a, b) =>
      a.organizationId.localeCompare(b.organizationId),
    )[0];
    const accounts = await database.db
      .insert(database.balanceAccounts)
      .values([
        {
          organizationId: target.organizationId,
          asset: "answerbit_points",
          balance: 117,
        },
        {
          organizationId: target.organizationId,
          brandId: target.brandId,
          asset: "answerbit_points",
          balance: 700,
        },
        {
          organizationId: target.organizationId,
          asset: "publication_cny",
          balance: 299,
        },
        {
          organizationId: target.organizationId,
          brandId: target.brandId,
          asset: "publication_cny",
          balance: 502,
        },
      ])
      .returning();
    const actorId = randomUUID(),
      actorName = `流水操作员-${randomUUID().slice(0, 8)}`,
      actorUsername = `ledger-${randomUUID().slice(0, 12)}`;
    const actors = Array.from({ length: 100 }, (_, i) => ({
      id: randomUUID(),
      name: `${marker}操作员${i}`,
      email: `${randomUUID()}@test.invalid`,
      createdAt: new Date("2025-01-01"),
    }));
    actors.push({
      id: actorId,
      name: actorName,
      email: `${actorId}@test.invalid`,
      createdAt: past,
    });
    await database.db.insert(database.users).values(actors);
    await database.db
      .update(database.users)
      .set({ username: actorUsername })
      .where(operators.eq(database.users.id, actorId));
    fixture.extraUserIds = actors.map((row) => row.id);
    await database.db.insert(database.balanceTransactions).values(
      Array.from({ length: 23 }, (_, i) => ({
        organizationId: target.organizationId,
        asset: "answerbit_points" as const,
        operation: "allocate" as const,
        sourceAccountId: accounts[0].id,
        targetAccountId: accounts[1].id,
        amount: 7,
        reason: `${marker}流水${i}`,
        referenceType: "allocation",
        referenceId: randomUUID(),
        idempotencyKey: randomUUID(),
        actorUserId: actorId,
        createdAt: past,
      })),
    );
    await page.goto(
      `/admin?section=balances&fundKeyword=${encodeURIComponent(marker)}&fundPage=11&fundPageSize=10&ledgerOperation=restore&ledgerPageSize=10`,
    );
    const row = page
      .getByRole("region", { name: "企业资产目录，可横向滚动", exact: true })
      .locator("tr")
      .filter({ hasText: target.brandId });
    await expect(row).toBeVisible();
    await expect(row.getByText("117 积分", { exact: true })).toBeVisible();
    await expect(row.getByText("700 积分", { exact: true })).toBeVisible();
    await expect(row.getByText("¥2.99", { exact: true })).toBeVisible();
    await expect(row.getByText("¥5.02", { exact: true })).toBeVisible();
    await expect(
      page.getByText("共 105 家腾讯企业", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(row).toBeVisible();
    await expect(page).toHaveURL(/fundPage=11/);
    await page
      .getByLabel("搜索企业或品牌", { exact: true })
      .fill(target.brandId);
    await page.getByLabel("搜索企业或品牌", { exact: true }).press("Enter");
    await expect(
      page.getByText("共 1 家腾讯企业", { exact: true }),
    ).toBeVisible();
    await row.getByRole("button", { name: "查看流水", exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`ledgerOrganizationId=${target.organizationId}`),
    );
    expect(new URL(page.url()).searchParams.has("ledgerOperation")).toBeFalsy();
    const ledger = page.locator("#admin-balance-ledger");
    await expect(
      ledger.getByText("共 23 条资产流水", { exact: true }),
    ).toBeVisible();
    await expect(
      ledger
        .getByText(`企业资金池 → 品牌 ${target.brandId}`, { exact: true })
        .first(),
    ).toBeVisible();
    await ledger.locator(".ant-pagination-item-2").click();
    await expect(page).toHaveURL(/ledgerPage=2/);
    await page.reload();
    await expect(
      ledger.getByText("共 23 条资产流水", { exact: true }),
    ).toBeVisible();
    await expect(ledger.locator(".ant-pagination-item-active")).toHaveAttribute(
      "title",
      "2",
    );
    await page.getByRole("menuitem", { name: /企业与品牌/ }).click();
    await page.getByRole("menuitem", { name: /资产与计费/ }).click();
    await expect(row).toBeVisible();
    await expect(ledger.locator(".ant-pagination-item-active")).toHaveAttribute(
      "title",
      "2",
    );
    const organizationFilter = ledger.getByRole("combobox", {
      name: "按企业筛选平台余额流水",
      exact: true,
    });
    await organizationFilter.press("ArrowDown");
    await organizationFilter.fill(target.brandId);
    await page
      .locator(".ant-select-item-option")
      .filter({ hasText: target.brandId })
      .click();
    const userFilter = ledger.getByRole("combobox", {
      name: "按操作用户筛选平台余额流水",
      exact: true,
    });
    await userFilter.press("ArrowDown");
    await userFilter.fill(actorUsername);
    await page
      .locator(".ant-select-item-option")
      .filter({ hasText: actorUsername })
      .click();
    await expect(page).toHaveURL(new RegExp(`ledgerUserId=${actorId}`));
    await expect(
      ledger.getByText("共 23 条资产流水", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      ledger.getByText(`${actorName} (@${actorUsername})`, { exact: true }),
    ).toBeVisible();
    const directoryResponse = await page.request.get(
      `/api/v1/admin/organization-balances?page=1&pageSize=20&q=${target.brandId}`,
    );
    expect(directoryResponse.ok()).toBeTruthy();
    const invalid = await page.request.get(
      "/api/v1/admin/organization-balances?accessState=invalid",
    );
    expect(invalid.status()).toBe(400);
  });

  test("资产目录与流水读取独立，迟到范围不覆盖，明暗主题与多尺寸错误可重试", async ({
    page,
  }) => {
    await makePlatformAdministrator();
    await mockAdminReads(page);
    const [first, second] = fixture.scopes;
    const reasons = [`资产甲-${randomUUID()}`, `资产乙-${randomUUID()}`];
    await database.db.insert(database.balanceTransactions).values(
      [first, second].map((scope, i) => ({
        organizationId: scope.organizationId,
        asset: "answerbit_points" as const,
        operation: "grant" as const,
        amount: 3,
        referenceType: "manual_grant",
        referenceId: randomUUID(),
        idempotencyKey: randomUUID(),
        reason: reasons[i],
        actorUserId: fixture.userId,
      })),
    );
    let directoryFails = false,
      ledgerFails = false;
    let releaseDirectory!: () => void,
      directoryArrived!: () => void,
      directoryDone!: () => void;
    const directoryGate = new Promise<void>((resolve) => {
        releaseDirectory = resolve;
      }),
      arrived = new Promise<void>((resolve) => {
        directoryArrived = resolve;
      }),
      completed = new Promise<void>((resolve) => {
        directoryDone = resolve;
      });
    let held = false;
    await page.route(
      "**/api/v1/admin/organization-balances?**",
      async (route) => {
        const query = new URL(route.request().url()).searchParams.get("q");
        if (directoryFails)
          return route.fulfill({
            status: 503,
            json: {
              error: {
                code: "QA_UNAVAILABLE",
                message: "资产目录暂时无法读取",
              },
            },
          });
        if (!held && query === first.brandId) {
          held = true;
          const response = await route.fetch();
          directoryArrived();
          await directoryGate;
          await route.fulfill({ response }).catch(() => {});
          directoryDone();
          return;
        }
        return route.continue();
      },
    );
    await page.route("**/api/v1/admin/balance-transactions?**", (route) =>
      ledgerFails
        ? route.fulfill({
            status: 503,
            json: {
              error: {
                code: "QA_UNAVAILABLE",
                message: "资产流水暂时无法读取",
              },
            },
          })
        : route.continue(),
    );
    await page.goto("/admin?section=balances");
    await page
      .getByLabel("搜索企业或品牌", { exact: true })
      .fill(first.brandId);
    await page.getByLabel("搜索企业或品牌", { exact: true }).press("Enter");
    await arrived;
    await page
      .getByLabel("搜索企业或品牌", { exact: true })
      .fill(second.brandId);
    await page.getByLabel("搜索企业或品牌", { exact: true }).press("Enter");
    const secondRow = page
      .getByRole("region", { name: "企业资产目录，可横向滚动", exact: true })
      .locator("tr")
      .filter({ hasText: second.brandId });
    await expect(secondRow).toBeVisible();
    releaseDirectory();
    await completed;
    await expect(
      page.locator("tr").filter({ hasText: first.brandId }),
    ).not.toBeVisible();
    await secondRow
      .getByRole("button", { name: "查看流水", exact: true })
      .click();
    const ledger = page.locator("#admin-balance-ledger");
    await expect(ledger.getByText(reasons[1], { exact: true })).toBeVisible();
    directoryFails = true;
    await page
      .getByRole("button", { name: "刷新当前模块", exact: true })
      .click();
    await expect(
      page.getByText("资产目录暂时无法读取", { exact: true }),
    ).toBeVisible();
    await expect(ledger.getByText(reasons[1], { exact: true })).toBeVisible();
    directoryFails = false;
    await page
      .getByRole("button", { name: "重试读取企业目录", exact: true })
      .click();
    await expect(secondRow).toBeVisible();
    ledgerFails = true;
    await page
      .getByRole("button", { name: "刷新当前模块", exact: true })
      .click();
    await expect(
      page.getByText("资产流水暂时无法读取", { exact: true }),
    ).toBeVisible();
    await expect(secondRow).toBeVisible();
    await expect(
      ledger.getByText(reasons[1], { exact: true }),
    ).not.toBeVisible();
    for (const theme of ["light", "dark"]) {
      if ((await page.locator("html").getAttribute("data-theme")) !== theme)
        await page.getByRole("button", { name: "切换亮暗色模式" }).click();
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBeTruthy();
        await page.evaluate(async () => {
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (a) => a.effect?.getComputedTiming().iterations !== Infinity,
              )
              .map((a) => a.finished.catch(() => {})),
          );
        });
        await page.evaluate(axe.source);
        const scan = await page.evaluate(() =>
          (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          }),
        );
        expect(scan.violations.map(({ id }) => id)).toEqual([]);
        if (width === 390)
          await page.screenshot({
            path: test.info().outputPath(`asset-directory-${theme}.png`),
          });
      }
    }
    ledgerFails = false;
    await page
      .getByRole("button", { name: "重试读取平台流水", exact: true })
      .click();
    await expect(ledger.getByText(reasons[1], { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("fundKeyword")).toBe(
      second.brandId,
    );
  });

  test("资产入账校验整数与金额，失败保留输入，成功响应丢失刷新恢复并只读核对", async ({
    page,
  }) => {
    await makePlatformAdministrator();
    await mockAdminReads(page);
    const scope = fixture.scopes[0],
      name = `资产入账-${randomUUID().slice(0, 8)}`;
    await database.db
      .update(database.organizations)
      .set({ name })
      .where(operators.eq(database.organizations.id, scope.organizationId));
    let rejectWrite = true,
      failConfirmation = true,
      failRefresh = false;
    const commands: Array<{
      idempotencyKey: string;
      amount: number;
      reason: string;
    }> = [];
    await page.route("**/api/v1/admin/balance-grants", async (route) => {
      commands.push(route.request().postDataJSON());
      if (rejectWrite)
        return route.fulfill({
          status: 422,
          json: { error: { code: "QA_REJECTED", message: "模拟入账校验失败" } },
        });
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    });
    await page.route(
      "**/api/v1/admin/balance-transactions/confirmation?**",
      async (route) => {
        if (failConfirmation)
          return route.fulfill({
            status: 503,
            json: {
              error: { code: "QA_UNAVAILABLE", message: "暂时无法核对" },
            },
          });
        return route.continue();
      },
    );
    await page.route(
      "**/api/v1/admin/organization-balances?**",
      async (route) => {
        if (failRefresh)
          return route.fulfill({
            status: 503,
            json: {
              error: {
                code: "QA_UNAVAILABLE",
                message: "余额目录暂时无法刷新",
              },
            },
          });
        return route.continue();
      },
    );
    await page.goto("/admin?section=balances");
    const row = page.locator("tr").filter({ hasText: name });
    await row.getByRole("button", { name: "入账 / 扣减", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: `${name} · 资产调整`,
      exact: true,
    });
    await dialog
      .getByLabel("调整原因", { exact: true })
      .fill("  账本测试入账  ");
    await dialog.getByLabel("数量", { exact: true }).fill("17.2");
    await dialog.getByRole("button", { name: "确认入账", exact: true }).click();
    await expect(
      dialog.getByText("积分须为 1 至 10 亿的整数", { exact: true }),
    ).toBeVisible();
    expect(commands).toHaveLength(0);
    await dialog.getByLabel("资产", { exact: true }).press("ArrowDown");
    await page
      .locator(".ant-select-item-option")
      .filter({ hasText: "发布人民币余额（元）" })
      .click();
    await dialog.getByLabel("数量", { exact: true }).fill("0.001");
    await dialog.getByRole("button", { name: "确认入账", exact: true }).click();
    await expect(
      dialog.getByText("金额须为 0.01 至 1000 万元，最多两位小数", {
        exact: true,
      }),
    ).toBeVisible();
    expect(commands).toHaveLength(0);
    await dialog.getByLabel("资产", { exact: true }).press("ArrowDown");
    await page
      .locator(".ant-select-item-option")
      .filter({ hasText: "腾讯能力积分" })
      .click();
    await dialog.getByLabel("数量", { exact: true }).fill("17");
    await dialog.getByRole("button", { name: "确认入账", exact: true }).click();
    await expect(
      dialog.getByText("模拟入账校验失败", { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByLabel("数量", { exact: true })).toHaveValue("17");
    await expect(dialog.getByLabel("调整原因", { exact: true })).toHaveValue(
      "账本测试入账",
    );
    await page.evaluate(axe.source);
    const editableScan = await page.evaluate(() =>
      (window as unknown as { axe: typeof axe }).axe.run(
        document.querySelector(
          '.ant-modal[role="dialog"], .ant-modal [role="dialog"]',
        )!,
        { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } },
      ),
    );
    expect(editableScan.violations.map(({ id }) => id)).toEqual([]);
    rejectWrite = false;
    await dialog.getByRole("button", { name: "确认入账", exact: true }).click();
    await expect(
      dialog.getByText(
        "提交结果尚未核实，请先核对操作结果，避免重复入账或扣减。",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(dialog.getByLabel("数量", { exact: true })).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "按原内容重试", exact: true }),
    ).not.toBeVisible();
    await page.reload();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("17 积分", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("数量", { exact: true })).toHaveValue("17");
    await expect(dialog.getByLabel("数量", { exact: true })).toBeDisabled();
    await expect(dialog.getByLabel("调整原因", { exact: true })).toHaveValue(
      "账本测试入账",
    );
    expect(commands).toHaveLength(2);
    for (const theme of ["light", "dark"]) {
      if ((await page.locator("html").getAttribute("data-theme")) !== theme) {
        await page.evaluate(
          (mode) => localStorage.setItem("ab-theme", mode),
          theme,
        );
        await page.reload();
        await expect(dialog).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      }
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(async () => {
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (a) => a.effect?.getComputedTiming().iterations !== Infinity,
              )
              .map((a) => a.finished.catch(() => {})),
          );
        });
        await page.evaluate(axe.source);
        const result = await page.evaluate(() =>
          (window as unknown as { axe: typeof axe }).axe.run(
            document.querySelector(
              '.ant-modal[role="dialog"], .ant-modal [role="dialog"]',
            )!,
            {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa"],
              },
            },
          ),
        );
        expect(result.violations.map(({ id }) => id)).toEqual([]);
        if (width === 390)
          await page.screenshot({
            path: test
              .info()
              .outputPath(`asset-adjustment-pending-${theme}.png`),
          });
      }
    }
    failConfirmation = false;
    failRefresh = true;
    await dialog
      .getByRole("button", { name: "核对操作结果", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByText("余额已入账，已记录资产流水与审计"),
    ).toBeVisible();
    await expect(
      page.getByText("余额目录暂时无法刷新", { exact: true }),
    ).toBeVisible();
    expect(commands).toHaveLength(2);
    const transactions = await database.db
      .select()
      .from(database.balanceTransactions)
      .where(
        operators.and(
          operators.eq(
            database.balanceTransactions.organizationId,
            scope.organizationId,
          ),
          operators.eq(database.balanceTransactions.operation, "grant"),
        ),
      );
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      amount: 17,
      reason: "账本测试入账",
      idempotencyKey: commands[1].idempotencyKey,
    });
    const audits = await database.db
      .select()
      .from(database.operationLogs)
      .where(
        operators.eq(database.operationLogs.resourceId, transactions[0].id),
      );
    expect(audits).toHaveLength(1);
    expect(
      await page.evaluate(
        (actor) =>
          sessionStorage.getItem(`geo:admin-asset-adjustment:v1:${actor}`),
        fixture.userId,
      ),
    ).toBeNull();
  });

  test("资产扣减未执行时按原键重试，企业与品牌账户独立，余额不足保留原表单", async ({
    page,
  }) => {
    await makePlatformAdministrator();
    await mockAdminReads(page);
    const scope = fixture.scopes[0],
      name = `资产扣减-${randomUUID().slice(0, 8)}`;
    await database.db
      .update(database.organizations)
      .set({ name })
      .where(operators.eq(database.organizations.id, scope.organizationId));
    await database.db.insert(database.balanceAccounts).values({
      organizationId: scope.organizationId,
      asset: "answerbit_points",
      balance: 100,
    });
    const commands: Array<{
      idempotencyKey: string;
      brandId?: string;
      amount: number;
    }> = [];
    await page.route("**/api/v1/admin/balance-deductions", async (route) => {
      commands.push(route.request().postDataJSON());
      if (commands.length === 1) return route.abort("failed");
      return route.continue();
    });
    await page.goto("/admin?section=balances");
    const row = page.locator("tr").filter({ hasText: name });
    await row.getByRole("button", { name: "入账 / 扣减", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: `${name} · 资产调整`,
      exact: true,
    });
    await dialog.getByRole("radio", { name: "手动扣减", exact: true }).click();
    await dialog.getByLabel("数量", { exact: true }).fill("17");
    await dialog.getByLabel("调整原因", { exact: true }).fill("人工纠错扣减");
    await dialog
      .getByRole("button", { name: "确认手动扣减", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "按原内容重试", exact: true }),
    ).toBeVisible();
    await expect(dialog.getByLabel("数量", { exact: true })).toBeDisabled();
    await dialog
      .getByRole("button", { name: "按原内容重试", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    await row.getByRole("button", { name: "入账 / 扣减", exact: true }).click();
    await dialog.getByRole("radio", { name: "手动扣减", exact: true }).click();
    await dialog.getByRole("radio", { name: "品牌账户", exact: true }).click();
    await dialog.getByLabel("数量", { exact: true }).fill("1001");
    await dialog.getByLabel("调整原因", { exact: true }).fill("品牌纠错扣减");
    await dialog
      .getByRole("button", { name: "确认手动扣减", exact: true })
      .click();
    await expect(
      dialog.getByText("当前账户余额不足，无法扣减", { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByLabel("数量", { exact: true })).toHaveValue(
      "1001",
    );
    await expect(
      dialog.getByRole("radio", { name: "品牌账户", exact: true }),
    ).toBeChecked();
    await dialog.getByLabel("数量", { exact: true }).fill("23");
    await dialog
      .getByRole("button", { name: "确认手动扣减", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const accounts = await database.db
      .select()
      .from(database.balanceAccounts)
      .where(
        operators.and(
          operators.eq(
            database.balanceAccounts.organizationId,
            scope.organizationId,
          ),
          operators.eq(database.balanceAccounts.asset, "answerbit_points"),
        ),
      );
    expect(accounts.find((a) => a.brandId === null)?.balance).toBe(83);
    expect(accounts.find((a) => a.brandId === scope.brandId)?.balance).toBe(
      977,
    );
    expect(commands[3].brandId).toBe(scope.brandId);
    expect(commands[3].idempotencyKey).not.toBe(commands[0].idempotencyKey);
  });

  test("企业续期保留空积分期限，失败保留输入，冻结与续期响应丢失只读核对一次写入", async ({
    page,
  }) => {
    await makePlatformAdministrator();
    await mockAdminReads(page);
    const scope = fixture.scopes[0];
    const { db, organizations, operationLogs } = database;
    const { eq, and } = operators;
    await db
      .update(organizations)
      .set({ serviceExpiresAt: null, pointsExpiresAt: null })
      .where(eq(organizations.id, scope.organizationId));
    let writes = 0,
      readsFail = false;
    const commands: Record<string, unknown>[] = [];
    await page.route(
      `**/api/v1/admin/organizations/${scope.organizationId}`,
      async (route) => {
        if (route.request().method() === "GET") {
          if (readsFail)
            return route.fulfill({
              status: 503,
              json: { error: { message: "企业读取暂不可用" } },
            });
          return route.continue();
        }
        writes++;
        commands.push(route.request().postDataJSON());
        if (writes === 1)
          return route.fulfill({
            status: 422,
            json: { error: { message: "请保留输入后重试" } },
          });
        const response = await route.fetch();
        expect(response.ok()).toBeTruthy();
        readsFail = true;
        await route.abort("failed");
      },
    );
    await page.goto("/admin?section=organizations");
    const row = page.locator("tr").filter({ hasText: scope.brandId });
    await row.getByRole("button", { name: "有效期", exact: true }).click();
    const validity = page.getByRole("dialog", {
      name: `${scope.name} · 企业有效期`,
      exact: true,
    });
    await expect(validity.getByLabel("积分到期", { exact: true })).toHaveValue(
      "",
    );
    await expect(
      validity.getByRole("button", { name: "保存有效期", exact: true }),
    ).toBeDisabled();
    await validity
      .getByRole("button", { name: "续 1 个月", exact: true })
      .click();
    await expect(
      validity.getByLabel("企业服务到期", { exact: true }),
    ).not.toHaveValue("");
    const original = await validity
      .getByLabel("企业服务到期", { exact: true })
      .inputValue();
    await validity
      .getByRole("button", { name: "保存有效期", exact: true })
      .click();
    await expect(validity.getByText("请保留输入后重试")).toBeVisible();
    await expect(
      validity.getByLabel("企业服务到期", { exact: true }),
    ).toHaveValue(original);
    for (const selectedTheme of ["dark", "light"]) {
      await validity.getByRole("button", { name: /取\s*消/ }).click();
      if (
        (await page.locator("html").getAttribute("data-theme")) !==
        selectedTheme
      )
        await page.getByRole("button", { name: "切换亮暗色模式" }).click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        selectedTheme,
      );
      await row.getByRole("button", { name: "有效期", exact: true }).click();
      await validity
        .getByRole("button", { name: "续 1 个月", exact: true })
        .click();
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBeTruthy();
        await page.evaluate(async () => {
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.effect?.getComputedTiming().iterations !== Infinity,
              )
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        await page.evaluate(axe.source);
        const scan = await page.evaluate(() =>
          (window as unknown as { axe: typeof axe }).axe.run(
            document.querySelector(
              '.ant-modal [role="dialog"], .ant-modal[role="dialog"]',
            )!,
            {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa"],
              },
            },
          ),
        );
        expect(scan.violations.map(({ id }) => id)).toEqual([]);
        if (width === 390)
          await page.screenshot({
            path: test
              .info()
              .outputPath(`enterprise-validity-${selectedTheme}.png`),
          });
      }
    }
    await validity
      .getByRole("button", { name: "保存有效期", exact: true })
      .click();
    await expect(
      validity.getByRole("button", { name: "核对操作结果", exact: true }),
    ).toBeVisible();
    await expect(
      validity.getByLabel("企业服务到期", { exact: true }),
    ).toBeDisabled();
    await expect(
      validity.getByRole("button", { name: /取\s*消/ }),
    ).toBeDisabled();
    const failedCheck = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/api/v1/admin/organizations/${scope.organizationId}`) &&
        response.request().method() === "GET" &&
        response.status() === 503,
    );
    await validity
      .getByRole("button", { name: "核对操作结果", exact: true })
      .click();
    await failedCheck;
    await expect(
      validity.getByRole("button", { name: "核对操作结果", exact: true }),
    ).toBeEnabled();
    expect(writes).toBe(2);
    readsFail = false;
    await validity
      .getByRole("button", { name: "核对操作结果", exact: true })
      .click();
    await expect(validity).not.toBeVisible();
    expect(writes).toBe(2);
    expect(commands[1]).not.toHaveProperty("pointsExpiresAt");
    const [renewed] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, scope.organizationId));
    expect(renewed.pointsExpiresAt).toBeNull();
    expect(renewed.serviceExpiresAt!.toISOString()).toBe(
      commands[1].serviceExpiresAt,
    );
    await row
      .getByRole("button", { name: `冻结企业 ${scope.name}`, exact: true })
      .click();
    const freeze = page.getByRole("dialog", {
      name: "冻结此企业？",
      exact: true,
    });
    await expect(
      freeze.getByText(/所有成员将暂停本企业的新业务操作/),
    ).toBeVisible();
    await freeze.getByRole("button", { name: /取\s*消/ }).click();
    expect(writes).toBe(2);
    await row
      .getByRole("button", { name: `冻结企业 ${scope.name}`, exact: true })
      .click();
    for (const selectedTheme of ["dark", "light"]) {
      await freeze.getByRole("button", { name: /取\s*消/ }).click();
      if (
        (await page.locator("html").getAttribute("data-theme")) !==
        selectedTheme
      )
        await page.getByRole("button", { name: "切换亮暗色模式" }).click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        selectedTheme,
      );
      await row
        .getByRole("button", { name: `冻结企业 ${scope.name}`, exact: true })
        .click();
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBeTruthy();
        await page.evaluate(async () => {
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.effect?.getComputedTiming().iterations !== Infinity,
              )
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        await page.evaluate(axe.source);
        const scan = await page.evaluate(() =>
          (window as unknown as { axe: typeof axe }).axe.run(
            document.querySelector(
              '.ant-modal [role="dialog"], .ant-modal[role="dialog"]',
            )!,
            {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa"],
              },
            },
          ),
        );
        expect(scan.violations.map(({ id }) => id)).toEqual([]);
        if (width === 390)
          await page.screenshot({
            path: test
              .info()
              .outputPath(`enterprise-freeze-${selectedTheme}.png`),
          });
      }
    }
    await freeze.getByRole("button", { name: "确认冻结", exact: true }).click();
    await expect(
      freeze.getByRole("button", { name: "核对操作结果", exact: true }),
    ).toBeVisible();
    readsFail = false;
    await freeze
      .getByRole("button", { name: "核对操作结果", exact: true })
      .click();
    await expect(freeze).not.toBeVisible();
    expect(writes).toBe(3);
    await expect(row.getByText("已冻结", { exact: true })).toBeVisible();
    const audit = await db
      .select()
      .from(operationLogs)
      .where(
        and(
          eq(operationLogs.organizationId, scope.organizationId),
          eq(operationLogs.operation, "platform.organization.update"),
        ),
      );
    expect(audit).toHaveLength(2);
  });

  test("已到期企业从恢复直接续期，积分期限独立，多人续期冲突保留输入并从最新日期继续", async ({
    page,
  }) => {
    await makePlatformAdministrator();
    await mockAdminReads(page);
    const scope = fixture.scopes[0];
    const { db, organizations } = database;
    const { eq } = operators;
    const expired = new Date("2020-01-01T00:00:00Z");
    await db
      .update(organizations)
      .set({
        status: "suspended",
        serviceExpiresAt: expired,
        pointsExpiresAt: expired,
      })
      .where(eq(organizations.id, scope.organizationId));
    await page.goto("/admin?section=organizations");
    const row = page.locator("tr").filter({ hasText: scope.brandId });
    await row
      .getByRole("button", { name: `恢复企业 ${scope.name}`, exact: true })
      .click();
    const restore = page.getByRole("dialog", {
      name: "恢复此企业？",
      exact: true,
    });
    await expect(
      restore.getByText("企业服务已到期", { exact: true }),
    ).toBeVisible();
    await restore
      .getByRole("button", { name: "续期并恢复", exact: true })
      .click();
    const validity = page.getByRole("dialog", {
      name: `${scope.name} · 企业有效期`,
      exact: true,
    });
    await expect(
      validity.getByRole("checkbox", { name: "保存时一并恢复企业业务" }),
    ).toBeChecked();
    await expect(
      validity.getByRole("button", { name: "续期并恢复企业", exact: true }),
    ).toBeDisabled();
    await validity
      .getByRole("button", { name: "续 1 个月", exact: true })
      .click();
    await validity
      .getByRole("button", { name: "续期并恢复企业", exact: true })
      .click();
    await expect(validity).not.toBeVisible();
    const [renewed] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, scope.organizationId));
    expect(renewed.status).toBe("active");
    expect(renewed.serviceExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(renewed.pointsExpiresAt).toEqual(expired);
    await row.getByRole("button", { name: "有效期", exact: true }).click();
    const beforeRenew = await validity
      .getByLabel("企业服务到期", { exact: true })
      .inputValue();
    await validity
      .getByRole("button", { name: "续 1 个月", exact: true })
      .click();
    await expect(
      validity.getByLabel("企业服务到期", { exact: true }),
    ).not.toHaveValue(beforeRenew);
    const draft = await validity
      .getByLabel("企业服务到期", { exact: true })
      .inputValue();
    const concurrentExpiry = "2038-01-01T00:00:00.123Z";
    const response = await page.request.patch(
      `/api/v1/admin/organizations/${scope.organizationId}`,
      {
        headers: { Origin: process.env.APP_URL! },
        data: {
          serviceExpiresAt: concurrentExpiry,
          expected: {
            serviceExpiresAt: renewed.serviceExpiresAt!.toISOString(),
          },
        },
      },
    );
    expect(response.ok()).toBeTruthy();
    await validity
      .getByRole("button", { name: "保存有效期", exact: true })
      .click();
    await expect(
      validity.getByText("请核对最新设置", { exact: true }),
    ).toBeVisible();
    await expect(
      validity.getByLabel("企业服务到期", { exact: true }),
    ).toHaveValue(draft);
    await expect(
      validity.getByRole("button", { name: "保存有效期", exact: true }),
    ).toBeDisabled();
    const [conflicted] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, scope.organizationId));
    expect(conflicted.serviceExpiresAt!.toISOString()).toBe(concurrentExpiry);
    await validity
      .getByRole("button", { name: "使用最新设置继续", exact: true })
      .click();
    await validity
      .getByRole("button", { name: "续 1 个月", exact: true })
      .click();
    await validity
      .getByRole("button", { name: "保存有效期", exact: true })
      .click();
    await expect(validity).not.toBeVisible();
    const [final] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, scope.organizationId));
    expect(final.serviceExpiresAt!.getTime()).toBeGreaterThan(
      new Date(concurrentExpiry).getTime(),
    );
    expect(final.pointsExpiresAt).toEqual(expired);
  });

  test("平台企业成员停用与移除保留失败确认，授权和停用响应丢失只读核对，刷新失败可恢复", async ({
    page,
  }) => {
    await makePlatformAdministrator();
    const { db, users, roles, organizationMembers, memberRoles } = database;
    const { eq, and } = operators;
    const scope = fixture.scopes[0];
    const [role] = await db
      .select()
      .from(roles)
      .where(eq(roles.code, "tenant_admin"));
    const [actorMember] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, scope.organizationId),
          eq(organizationMembers.userId, fixture.userId),
        ),
      );
    await db
      .insert(memberRoles)
      .values({ memberId: actorMember.id, roleId: role.id });
    const backupId = randomUUID(),
      backupUsername = `platform_backup_${randomUUID().slice(0, 8)}`;
    await db.insert(users).values({
      id: backupId,
      name: "平台接任管理员",
      username: backupUsername,
      email: `${backupId}@workflow.invalid`,
      accountType: "agent",
      pricingTier: "bronze",
    });
    const [backup] = await db
      .insert(organizationMembers)
      .values({
        organizationId: scope.organizationId,
        userId: backupId,
        status: "active",
      })
      .returning();
    const expiredId = randomUUID();
    await db.insert(users).values({
      id: expiredId,
      name: "已到期代理商",
      username: `expired_${randomUUID().slice(0, 8)}`,
      email: `${expiredId}@workflow.invalid`,
      accountType: "agent",
      pricingTier: "bronze",
      agentExpiresAt: new Date(Date.now() - 60_000),
    });
    await db.insert(organizationMembers).values({
      organizationId: scope.organizationId,
      userId: expiredId,
      status: "active",
    });
    await mockAdminReads(page);
    let readsFail = false,
      grants = 0;
    const detailPath = `**/api/v1/admin/organizations/${scope.organizationId}`;
    const collection = `**/api/v1/admin/organizations/${scope.organizationId}/members`;
    await page.route(detailPath, (route) =>
      readsFail
        ? route.fulfill({
            status: 503,
            json: { error: { message: "企业目录暂不可用" } },
          })
        : route.continue(),
    );
    await page.route(collection, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      grants++;
      if (grants === 1) {
        readsFail = true;
        return route.fulfill({
          status: 503,
          json: { error: { message: "授权暂不可用" } },
        });
      }
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      readsFail = true;
      await route.abort("failed");
    });
    await page.goto("/admin?section=organizations");
    await page
      .locator("tr")
      .filter({ hasText: scope.brandId })
      .getByRole("button", { name: `管理企业 ${scope.name}`, exact: true })
      .click();
    const drawer = page.getByRole("dialog", {
      name: `企业详情 · ${scope.name}`,
    });
    await expect(drawer.getByText("账号已过期", { exact: true })).toBeVisible();
    await expect(
      drawer
        .locator(".ant-statistic")
        .filter({ hasText: "有效成员" })
        .locator(".ant-statistic-content-value"),
    ).toHaveText("2");
    await drawer
      .getByRole("button", { name: "停用企业成员 操作流程测试", exact: true })
      .click();
    const statusDialog = page.getByRole("dialog", { name: "停用企业成员？" });
    await expect(
      statusDialog.getByText(new RegExp(fixture.username)),
    ).toBeVisible();
    await statusDialog
      .getByRole("button", { name: "确认停用", exact: true })
      .click();
    await expect(
      statusDialog.getByText(/企业必须保留至少一名可用管理员/),
    ).toBeVisible();
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") {
        await statusDialog.getByRole("button", { name: /取\s*消/ }).click();
        await drawer.getByRole("button", { name: /close|关闭/i }).click();
        await page.getByRole("button", { name: "切换亮暗色模式" }).click();
        await page
          .locator("tr")
          .filter({ hasText: scope.brandId })
          .getByRole("button", { name: `管理企业 ${scope.name}`, exact: true })
          .click();
        await drawer
          .getByRole("button", {
            name: "停用企业成员 操作流程测试",
            exact: true,
          })
          .click();
        await statusDialog
          .getByRole("button", { name: "确认停用", exact: true })
          .click();
        await expect(
          statusDialog.getByText(/企业必须保留至少一名可用管理员/),
        ).toBeVisible();
      }
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBeTruthy();
        await page.evaluate(axe.source);
        const result = await page.evaluate(async () =>
          (window as unknown as { axe: typeof axe }).axe.run(
            document.querySelector(
              '.ant-modal [role="dialog"], .ant-modal[role="dialog"]',
            )!,
            {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa"],
              },
            },
          ),
        );
        expect(result.violations.map(({ id }) => id)).toEqual([]);
      }
    }
    await statusDialog.getByRole("button", { name: /取\s*消/ }).click();
    await drawer
      .getByRole("button", { name: "移出企业成员 操作流程测试", exact: true })
      .click();
    const removeDialog = page.getByRole("dialog", { name: "移出此企业？" });
    await removeDialog
      .getByRole("button", { name: "确认移出", exact: true })
      .click();
    await expect(
      removeDialog.getByText(/企业必须保留至少一名可用管理员/),
    ).toBeVisible();
    await removeDialog.getByRole("button", { name: /取\s*消/ }).click();
    await drawer.getByLabel("平台用户", { exact: true }).click();
    await drawer.getByLabel("平台用户", { exact: true }).fill(backupUsername);
    await page
      .locator(".ant-select-item-option")
      .filter({ hasText: backupUsername })
      .click();
    await drawer
      .getByRole("button", { name: "保存成员权限", exact: true })
      .click();
    await expect(
      drawer.getByText("提交结果尚未核实，请先核对结果，避免重复操作。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(drawer.getByLabel("平台用户", { exact: true })).toBeDisabled();
    readsFail = false;
    await drawer
      .getByRole("button", { name: "核对操作结果", exact: true })
      .click();
    await expect(
      drawer.getByText(
        "核对后未发现这次变更，请检查当前成员关系后重新确认操作。",
        { exact: true },
      ),
    ).toBeVisible();
    expect(grants).toBe(1);
    await expect(drawer.getByLabel("平台用户", { exact: true })).toBeEnabled();
    await expect(
      drawer
        .locator(".ant-select-selection-item")
        .filter({ hasText: backupUsername }),
    ).toBeVisible();
    await drawer
      .getByRole("button", { name: "保存成员权限", exact: true })
      .click();
    await expect(
      drawer.getByRole("button", { name: "核对操作结果", exact: true }),
    ).toBeVisible();
    readsFail = false;
    await drawer
      .getByRole("button", { name: "核对操作结果", exact: true })
      .click();
    await expect(
      drawer.getByRole("button", { name: "核对操作结果", exact: true }),
    ).toHaveCount(0);
    expect(grants).toBe(2);
    expect(
      (
        await db
          .select()
          .from(memberRoles)
          .where(
            and(
              eq(memberRoles.memberId, backup.id),
              eq(memberRoles.roleId, role.id),
            ),
          )
      ).length,
    ).toBe(1);
    let statusWrites = 0;
    await page.route(
      `**/api/v1/admin/organizations/${scope.organizationId}/members/${backup.id}`,
      async (route) => {
        if (route.request().method() !== "PATCH") return route.continue();
        statusWrites++;
        const response = await route.fetch();
        expect(response.ok()).toBeTruthy();
        readsFail = true;
        await route.abort("failed");
      },
    );
    await drawer
      .getByRole("button", { name: "停用企业成员 平台接任管理员", exact: true })
      .click();
    await statusDialog
      .getByRole("button", { name: "确认停用", exact: true })
      .click();
    await expect(
      statusDialog.getByRole("button", { name: "核对操作结果", exact: true }),
    ).toBeVisible();
    readsFail = false;
    await statusDialog
      .getByRole("button", { name: "核对操作结果", exact: true })
      .click();
    await expect(statusDialog).not.toBeVisible();
    expect(statusWrites).toBe(1);
    await page.unroute(
      `**/api/v1/admin/organizations/${scope.organizationId}/members/${backup.id}`,
    );
    await db
      .update(users)
      .set({ status: "disabled" })
      .where(eq(users.id, backupId));
    await drawer
      .getByRole("button", { name: "刷新企业详情", exact: true })
      .click();
    await expect(drawer.getByText("账号已停用", { exact: true })).toBeVisible();
    await drawer
      .getByRole("button", { name: "启用企业成员 平台接任管理员", exact: true })
      .click();
    const activate = page.getByRole("dialog", { name: "启用企业成员？" });
    await activate
      .getByRole("button", { name: "确认启用", exact: true })
      .click();
    await expect(
      activate.getByText("该账户已停用", { exact: true }),
    ).toBeVisible();
    await activate.getByRole("button", { name: /取\s*消/ }).click();
    // A successful removal is distinct from a failed directory refresh.
    await page.unroute(
      `**/api/v1/admin/organizations/${scope.organizationId}/members/${backup.id}`,
    );
    let deletes = 0;
    await page.route(
      `**/api/v1/admin/organizations/${scope.organizationId}/members/${backup.id}`,
      async (route) => {
        deletes++;
        const response = await route.fetch();
        expect(response.ok()).toBeTruthy();
        readsFail = true;
        await route.fulfill({ response });
      },
    );
    await drawer
      .getByRole("button", { name: "移出企业成员 平台接任管理员", exact: true })
      .click();
    await removeDialog
      .getByRole("button", { name: "确认移出", exact: true })
      .click();
    await expect(removeDialog).not.toBeVisible();
    await expect(
      drawer.getByText("企业详情刷新失败", { exact: true }),
    ).toBeVisible();
    readsFail = false;
    await drawer
      .getByRole("button", { name: "刷新企业详情", exact: true })
      .click();
    await expect(
      drawer.getByRole("button", {
        name: "移出企业成员 平台接任管理员",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(deletes).toBe(1);
  });

  test("用户档案企业授权保留输入，刷新不清空表单，品牌权限响应丢失核对原企业，移除只写一次", async ({
    page,
  }) => {
    await makePlatformAdministrator();
    const { db, users, organizationMembers, brandAccess } = database;
    const { eq, and } = operators;
    const scope = fixture.scopes[0];
    const targetId = randomUUID(),
      username = `profile_member_${randomUUID().slice(0, 8)}`;
    await db.insert(users).values({
      id: targetId,
      name: "档案品牌成员",
      username,
      email: `${targetId}@workflow.invalid`,
      accountType: "customer",
      pricingTier: "retail",
    });
    const [member] = await db
      .insert(organizationMembers)
      .values({
        organizationId: scope.organizationId,
        userId: targetId,
        status: "active",
      })
      .returning();
    const other = fixture.scopes[1];
    await db.insert(organizationMembers).values({
      organizationId: other.organizationId,
      userId: targetId,
      status: "active",
    });
    await db.insert(brandAccess).values({
      organizationId: other.organizationId,
      teamBindingId: other.teamBindingId,
      brandId: other.brandId,
      userId: targetId,
      role: "brand_admin",
    });
    await mockAdminReads(page);
    let readsFail = false,
      writes = 0;
    await page.route(
      `**/api/v1/admin/organizations/${scope.organizationId}`,
      (route) =>
        readsFail
          ? route.fulfill({
              status: 503,
              json: { error: { message: "权限核对暂不可用" } },
            })
          : route.continue(),
    );
    await page.route(
      `**/api/v1/admin/organizations/${scope.organizationId}/members`,
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        writes++;
        if (writes === 1)
          return route.fulfill({
            status: 422,
            json: { error: { code: "QA_DENIED", message: "权限保存暂时受限" } },
          });
        if (writes === 2)
          return route.fulfill({
            status: 503,
            json: { error: { message: "保存结果需核对" } },
          });
        const response = await route.fetch();
        expect(response.ok()).toBeTruthy();
        readsFail = true;
        await route.abort("failed");
      },
    );
    await page.goto("/admin?section=users");
    await page
      .getByPlaceholder("搜索姓名或登录账号", { exact: true })
      .fill(username);
    await page
      .getByPlaceholder("搜索姓名或登录账号", { exact: true })
      .press("Enter");
    await page
      .getByRole("button", { name: "管理用户 档案品牌成员", exact: true })
      .click();
    const drawer = page.getByRole("dialog", { name: "用户档案", exact: true });
    await drawer.getByLabel("目标企业", { exact: true }).click();
    await drawer.getByLabel("目标企业", { exact: true }).fill(scope.name);
    await page
      .locator(".ant-select-item-option")
      .filter({ hasText: scope.brandId })
      .click();
    await drawer
      .getByRole("button", { name: "保存企业权限", exact: true })
      .click();
    await expect(
      drawer.getByText("权限保存暂时受限", { exact: true }),
    ).toBeVisible();
    await drawer
      .getByRole("button", { name: "刷新用户档案", exact: true })
      .click();
    await expect(
      drawer
        .locator(".ant-select-selection-item")
        .filter({ hasText: scope.name }),
    ).toBeVisible();
    await drawer.getByLabel("企业角色", { exact: true }).press("ArrowDown");
    await page
      .locator(".ant-select-item-option")
      .filter({ hasText: "品牌管理员" })
      .click();
    await drawer
      .getByRole("button", { name: "保存企业权限", exact: true })
      .click();
    await expect(
      drawer.getByText(
        "核对后未发现这次变更，请检查当前成员关系后重新确认操作。",
        { exact: true },
      ),
    ).toBeVisible();
    expect(writes).toBe(2);
    await drawer
      .getByRole("button", { name: "保存企业权限", exact: true })
      .click();
    await expect(
      drawer.getByRole("button", { name: "核对操作结果", exact: true }),
    ).toBeVisible();
    readsFail = false;
    await drawer
      .getByRole("button", { name: "核对操作结果", exact: true })
      .click();
    await expect(
      drawer.getByRole("button", { name: "核对操作结果", exact: true }),
    ).toHaveCount(0);
    expect(writes).toBe(3);
    const access = await db
      .select()
      .from(brandAccess)
      .where(
        and(
          eq(brandAccess.userId, targetId),
          eq(brandAccess.organizationId, scope.organizationId),
        ),
      );
    expect(access).toHaveLength(1);
    expect(access[0]).toMatchObject({
      brandId: scope.brandId,
      role: "brand_admin",
    });
    let deletes = 0;
    await page.route(
      `**/api/v1/admin/organizations/${scope.organizationId}/members/${member.id}`,
      async (route) => {
        deletes++;
        const response = await route.fetch();
        expect(response.ok()).toBeTruthy();
        readsFail = true;
        await route.abort("failed");
      },
    );
    await drawer
      .getByRole("button", {
        name: `移出企业成员 档案品牌成员 · ${scope.name}`,
        exact: true,
      })
      .click();
    const confirmation = page.getByRole("dialog", { name: "移出此企业？" });
    await expect(confirmation.getByText(new RegExp(username))).toBeVisible();
    await confirmation
      .getByRole("button", { name: "确认移出", exact: true })
      .click();
    await expect(
      confirmation.getByRole("button", { name: "核对操作结果", exact: true }),
    ).toBeVisible();
    readsFail = false;
    await confirmation
      .getByRole("button", { name: "核对操作结果", exact: true })
      .click();
    await expect(confirmation).not.toBeVisible();
    await expect(
      drawer.getByRole("button", {
        name: `移出企业成员 档案品牌成员 · ${scope.name}`,
        exact: true,
      }),
    ).toHaveCount(0);
    expect(deletes).toBe(1);
    const remaining = await db
      .select()
      .from(brandAccess)
      .where(eq(brandAccess.userId, targetId));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({
      organizationId: other.organizationId,
      brandId: other.brandId,
      role: "brand_admin",
    });
    // Closing a drawer invalidates an in-flight refresh instead of reopening it.
    let requested = false,
      release!: () => void;
    const delayed = new Promise<void>((resolve) => (release = resolve));
    await page.route(`**/api/v1/admin/users/${targetId}`, async (route) => {
      requested = true;
      await delayed;
      await route.continue();
    });
    await drawer
      .getByRole("button", { name: "刷新用户档案", exact: true })
      .click();
    await expect.poll(() => requested).toBe(true);
    await drawer.getByRole("button", { name: /close|关闭/i }).click();
    release();
    await expect(drawer).not.toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(drawer).not.toBeVisible();
  });

  test("多企业管理员停用先交接，失败保留确认层并可直达企业，响应丢失核对一次写入", async ({
    page,
  }) => {
    const { db, users, roles, organizationMembers, memberRoles, sessions } =
      database;
    const { eq, and } = operators;
    await makePlatformAdministrator();
    const targetId = randomUUID(),
      backupId = randomUUID();
    const targetUsername = `handover_${randomUUID().slice(0, 8)}`;
    const backupUsername = `backup_${randomUUID().slice(0, 8)}`;
    await db.insert(users).values([
      {
        id: targetId,
        name: "待交接代理商",
        username: targetUsername,
        email: `${targetId}@workflow.invalid`,
        accountType: "agent",
        pricingTier: "bronze",
      },
      {
        id: backupId,
        name: "接任代理商",
        username: backupUsername,
        email: `${backupId}@workflow.invalid`,
        accountType: "agent",
        pricingTier: "bronze",
      },
    ]);
    const [role] = await db
      .select()
      .from(roles)
      .where(eq(roles.code, "tenant_admin"));
    for (const scope of fixture.scopes) {
      const members = await db
        .insert(organizationMembers)
        .values(
          [targetId, backupId].map((userId) => ({
            organizationId: scope.organizationId,
            userId,
            status: "active" as const,
          })),
        )
        .returning();
      await db.insert(memberRoles).values({
        memberId: members.find((member) => member.userId === targetId)!.id,
        roleId: role.id,
      });
    }
    await db.insert(sessions).values({
      userId: targetId,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const expiry = await page.request.patch(`/api/v1/admin/users/${targetId}`, {
      data: { agentValidFrom: new Date(Date.now() + 86_400_000).toISOString() },
    });
    expect(expiry.status()).toBe(409);
    expect((await expiry.json()).error.code).toBe("LAST_TENANT_ADMIN");
    await mockAdminReads(page);
    await page.goto("/admin?section=users");
    await page
      .getByPlaceholder("搜索姓名或登录账号", { exact: true })
      .fill(targetUsername);
    await page
      .getByPlaceholder("搜索姓名或登录账号", { exact: true })
      .press("Enter");
    await page
      .getByRole("button", { name: "停用账号 待交接代理商", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "停用此账户？" });
    await dialog.getByRole("button", { name: "确认停用", exact: true }).click();
    await expect(
      dialog.getByText("账号操作未完成", { exact: true }),
    ).toBeVisible();
    for (const scope of fixture.scopes)
      await expect(
        dialog.getByRole("button", {
          name: `管理企业 · ${scope.name}`,
          exact: true,
        }),
      ).toBeVisible();
    expect(
      (await db.select().from(sessions).where(eq(sessions.userId, targetId)))
        .length,
    ).toBe(1);
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") {
        await dialog.getByRole("button", { name: /取\s*消/ }).click();
        await page.getByRole("button", { name: "切换亮暗色模式" }).click();
        await page
          .getByRole("button", { name: "停用账号 待交接代理商", exact: true })
          .click();
        await dialog
          .getByRole("button", { name: "确认停用", exact: true })
          .click();
        await expect(
          dialog.getByText("账号操作未完成", { exact: true }),
        ).toBeVisible();
      }
      await expect
        .poll(() => page.locator("html").getAttribute("data-theme"))
        .toBe(theme);
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBeTruthy();
        await page.evaluate(axe.source);
        const result = await page.evaluate(async () =>
          (window as unknown as { axe: typeof axe }).axe.run(
            document.querySelector('[role="dialog"]')!,
            {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa"],
              },
            },
          ),
        );
        expect(result.violations.map(({ id }) => id)).toEqual([]);
      }
    }
    // Each protected enterprise is reachable from the rejected confirmation.
    for (const [index, scope] of fixture.scopes.entries()) {
      if (index) {
        await page
          .getByRole("button", { name: "停用账号 待交接代理商", exact: true })
          .click();
        await dialog
          .getByRole("button", { name: "确认停用", exact: true })
          .click();
        await expect(
          dialog.getByRole("button", {
            name: `管理企业 · ${scope.name}`,
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          dialog.getByRole("button", {
            name: `管理企业 · ${fixture.scopes[0].name}`,
            exact: true,
          }),
        ).toHaveCount(0);
      }
      await dialog
        .getByRole("button", { name: `管理企业 · ${scope.name}`, exact: true })
        .click();
      const drawer = page.getByRole("dialog", {
        name: `企业详情 · ${scope.name}`,
      });
      await expect(drawer).toBeVisible();
      await drawer.getByLabel("平台用户", { exact: true }).click();
      await drawer.getByLabel("平台用户", { exact: true }).fill(backupUsername);
      await page
        .locator(".ant-select-item-option")
        .filter({ hasText: backupUsername })
        .click();
      await drawer
        .getByRole("button", { name: "保存成员权限", exact: true })
        .click();
      await expect
        .poll(async () => {
          const [member] = await db
            .select()
            .from(organizationMembers)
            .where(
              and(
                eq(organizationMembers.organizationId, scope.organizationId),
                eq(organizationMembers.userId, backupId),
              ),
            );
          return (
            await db
              .select()
              .from(memberRoles)
              .where(
                and(
                  eq(memberRoles.memberId, member.id),
                  eq(memberRoles.roleId, role.id),
                ),
              )
          ).length;
        })
        .toBe(1);
      await drawer.getByRole("button", { name: /close|关闭/i }).click();
      await expect(drawer).not.toBeVisible();
    }
    let writes = 0,
      readsFail = false;
    await page.route(`**/api/v1/admin/users/${targetId}`, async (route) => {
      if (route.request().method() === "GET") {
        if (readsFail)
          return route.fulfill({
            status: 503,
            json: { error: { message: "核对暂不可用" } },
          });
        return route.continue();
      }
      writes++;
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      readsFail = true;
      await route.abort("failed");
    });
    await page
      .getByRole("button", { name: "停用账号 待交接代理商", exact: true })
      .click();
    await dialog.getByRole("button", { name: "确认停用", exact: true }).click();
    await expect(
      dialog.getByText("提交结果尚未核实，请先核对结果，避免重复操作。", {
        exact: true,
      }),
    ).toBeVisible();
    readsFail = false;
    await dialog
      .getByRole("button", { name: "核对操作结果", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    expect(writes).toBe(1);
    expect(
      (await db.select().from(sessions).where(eq(sessions.userId, targetId)))
        .length,
    ).toBe(0);
    expect(
      (await db.select().from(users).where(eq(users.id, targetId)))[0].status,
    ).toBe("disabled");
    const [actorMember] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(
            organizationMembers.organizationId,
            fixture.scopes[0].organizationId,
          ),
          eq(organizationMembers.userId, fixture.userId),
        ),
      );
    await db
      .insert(memberRoles)
      .values({ memberId: actorMember.id, roleId: role.id });
    await page.route("**/api/v1/organizations/**", (route) => route.continue());
    await page.goto(
      `/dashboard/settings/members?organizationId=${fixture.scopes[0].organizationId}`,
    );
    await expect(page.getByText("账号已停用", { exact: true })).toBeVisible();
    await expect(
      page
        .locator(".ant-statistic")
        .filter({ hasText: "企业管理员" })
        .locator(".ant-statistic-content-value"),
    ).toHaveText("2");
  });

  test("成员写入失败保留表单，现有角色正确回填，响应丢失不重复创建，最后管理员受保护", async ({
    page,
  }) => {
    const {
      db,
      users,
      roles,
      organizationMembers,
      memberRoles,
      billingPlans,
      billingPlanVersions,
      platformSubscriptions,
      subscriptionEntitlements,
    } = database;
    const { eq, and } = operators;
    const target = fixture.scopes[0];
    const collection = `/api/v1/organizations/${target.organizationId}/members`;
    await db
      .update(users)
      .set({ accountType: "agent" })
      .where(eq(users.id, fixture.userId));
    const [administrator] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, target.organizationId),
          eq(organizationMembers.userId, fixture.userId),
        ),
      );
    const [role] = await db
      .select()
      .from(roles)
      .where(eq(roles.code, "tenant_admin"));
    await db
      .insert(memberRoles)
      .values({ memberId: administrator.id, roleId: role.id });
    const [plan] = await db
      .select({ id: billingPlanVersions.id })
      .from(billingPlanVersions)
      .innerJoin(billingPlans, eq(billingPlans.id, billingPlanVersions.planId))
      .where(
        and(
          eq(billingPlans.code, "free"),
          eq(billingPlanVersions.status, "published"),
        ),
      );
    const periodStart = new Date(),
      periodEnd = new Date(Date.now() + 86_400_000);
    const [subscription] = await db
      .insert(platformSubscriptions)
      .values({
        organizationId: target.organizationId,
        planVersionId: plan.id,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      })
      .returning();
    await db.insert(subscriptionEntitlements).values({
      organizationId: target.organizationId,
      subscriptionId: subscription.id,
      entitlementKey: "members",
      limitAmount: 10,
      unit: "people",
      periodStart,
      periodEnd,
    });
    await mockBusinessApis(page);
    await page.route("**/api/v1/organizations/**", (route) => route.continue());
    let readsFail = false,
      creates = 0;
    await page.route(`**${collection}`, async (route) => {
      if (route.request().method() === "GET") {
        if (readsFail)
          return route.fulfill({
            status: 503,
            json: { error: { message: "成员目录暂时不可用" } },
          });
        return route.continue();
      }
      if (route.request().method() !== "POST") return route.continue();
      creates++;
      if (creates === 1)
        return route.fulfill({
          status: 503,
          json: { error: { message: "开户暂时失败" } },
        });
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      readsFail = true;
      await route.abort("failed");
    });
    await page.goto(
      `/dashboard/settings/members?organizationId=${target.organizationId}`,
    );
    await page.getByRole("button", { name: "添加成员", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "添加企业成员" });
    const username = `member_${randomUUID().slice(0, 8)}`;
    await dialog.getByLabel("成员姓名").fill("新运营成员");
    await dialog.getByLabel("登录账号").fill(username);
    await dialog.getByLabel("初始密码").fill("WorkflowMember123");
    await dialog.getByLabel("职责角色").press("ArrowDown");
    await page
      .locator(".ant-select-item-option")
      .filter({ hasText: "品牌编辑" })
      .click();
    await dialog
      .getByRole("button", { name: "添加并授权", exact: true })
      .click();
    await expect(
      dialog.getByText("开户暂时失败", { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByLabel("初始密码")).toHaveValue(
      "WorkflowMember123",
    );
    await dialog
      .getByRole("button", { name: "添加并授权", exact: true })
      .click();
    await expect(
      dialog.getByText("提交结果尚未核实，请先核对结果，避免重复操作。"),
    ).toBeVisible();
    await expect(dialog.getByLabel("登录账号")).toBeDisabled();
    await dialog
      .getByRole("button", { name: "核对操作结果", exact: true })
      .click();
    await expect(
      dialog.getByText("成员目录暂时不可用", { exact: true }),
    ).toBeVisible();
    expect(creates).toBe(2);
    readsFail = false;
    await dialog
      .getByRole("button", { name: "核对操作结果", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    expect(creates).toBe(2);
    await expect(
      page.getByText("客户账号已创建并加入企业", { exact: true }),
    ).toBeVisible();
    const directory = await page.request.get(collection);
    const created = (await directory.json()).data.members.find(
      (member: { username: string }) => member.username === username,
    );
    expect(created.brandAccess[0].role).toBe("brand_editor");
    expect(
      (await db.select().from(users).where(eq(users.username, username)))
        .length,
    ).toBe(1);
    // Existing authority must be selected when editing, rather than the default viewer.
    await page
      .getByRole("button", { name: "配置 新运营成员 的品牌权限", exact: true })
      .click();
    const accessDialog = page.getByRole("dialog", { name: "配置品牌权限" });
    await expect(accessDialog.locator(".ant-select-selection-item")).toHaveText(
      "品牌编辑",
    );
    await accessDialog.getByLabel("品牌角色").press("ArrowDown");
    await page
      .locator(".ant-select-item-option")
      .filter({ hasText: "品牌管理员" })
      .click();
    let updates = 0;
    await page.route(
      `**${collection}/${created.id}/brand-access`,
      async (route) => {
        updates++;
        if (updates === 1)
          return route.fulfill({
            status: 503,
            json: { error: { message: "权限更新暂时失败" } },
          });
        const response = await route.fetch();
        expect(response.ok()).toBeTruthy();
        readsFail = true;
        return route.fulfill({ response });
      },
    );
    await accessDialog
      .getByRole("button", { name: "保存权限", exact: true })
      .click();
    await expect(accessDialog.getByText("权限更新暂时失败")).toBeVisible();
    await expect(accessDialog.locator(".ant-select-selection-item")).toHaveText(
      "品牌管理员",
    );
    await accessDialog
      .getByRole("button", { name: "保存权限", exact: true })
      .click();
    await expect(accessDialog).not.toBeVisible();
    await expect(
      page.getByText("品牌访问范围已更新", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("成员目录加载失败", { exact: true }),
    ).toBeVisible();
    readsFail = false;
    await page
      .getByRole("button", { name: "重试加载成员", exact: true })
      .click();
    await expect(
      page.getByText("成员目录加载失败", { exact: true }),
    ).not.toBeVisible();
    await page
      .getByRole("button", { name: "停用成员 操作流程测试", exact: true })
      .click();
    const confirmation = page.getByRole("dialog", { name: "停用这个成员？" });
    await expect(
      confirmation.getByText(`操作流程测试（@${fixture.username}）`, {
        exact: true,
      }),
    ).toBeVisible();
    await confirmation
      .getByRole("button", { name: "确认停用", exact: true })
      .click();
    await expect(
      confirmation.getByText("企业必须保留至少一名可用管理员"),
    ).toBeVisible();
    await confirmation.getByRole("button", { name: /取\s*消/ }).click();
    await page
      .getByRole("button", { name: "停用成员 新运营成员", exact: true })
      .click();
    let toggles = 0;
    await page.route(`**${collection}/${created.id}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      toggles++;
      if (toggles === 1)
        return route.fulfill({
          status: 503,
          json: { error: { message: "停用暂时失败" } },
        });
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      await route.abort("failed");
    });
    await confirmation
      .getByRole("button", { name: "确认停用", exact: true })
      .click();
    await expect(
      confirmation.getByText("停用暂时失败", { exact: true }),
    ).toBeVisible();
    await confirmation
      .getByRole("button", { name: "确认停用", exact: true })
      .click();
    await expect(confirmation).not.toBeVisible();
    expect(toggles).toBe(2);
    await expect(page.getByText("成员已停用", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "将成员 新运营成员 移出企业", exact: true })
      .click();
    const removeDialog = page.getByRole("dialog", {
      name: "从企业移除这个成员？",
    });
    let removals = 0;
    await page.route(`**${collection}/${created.id}`, async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      removals++;
      if (removals === 1)
        return route.fulfill({
          status: 503,
          json: { error: { message: "移除暂时失败" } },
        });
      const response = await route.fetch();
      expect(response.status()).toBe(204);
      await route.abort("failed");
    });
    await removeDialog
      .getByRole("button", { name: "确认移除", exact: true })
      .click();
    await expect(
      removeDialog.getByText("移除暂时失败", { exact: true }),
    ).toBeVisible();
    await removeDialog
      .getByRole("button", { name: "确认移除", exact: true })
      .click();
    await expect(removeDialog).not.toBeVisible();
    expect(removals).toBe(2);
    await expect(
      page.getByText("成员已从企业移除", { exact: true }),
    ).toBeVisible();
    expect(
      (await db.select().from(users).where(eq(users.username, username)))
        .length,
    ).toBe(1);
    expect(
      (
        await db
          .select()
          .from(organizationMembers)
          .where(eq(organizationMembers.id, created.id))
      ).length,
    ).toBe(0);
    // Platform and enterprise entry points expose the same administrator invariant.
    await makePlatformAdministrator();
    const platformDelete = await page.request.delete(
      `/api/v1/admin/organizations/${target.organizationId}/members/${administrator.id}`,
    );
    expect(platformDelete.status()).toBe(409);
    expect((await platformDelete.json()).error.code).toBe("LAST_TENANT_ADMIN");
    for (const theme of ["light", "dark"]) {
      if (theme === "dark")
        await page.getByRole("button", { name: "切换亮暗色模式" }).click();
      await expect
        .poll(() => page.locator("html").getAttribute("data-theme"))
        .toBe(theme);
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBeTruthy();
        await page.evaluate(async () => {
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.effect?.getComputedTiming().iterations !== Infinity,
              )
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        await page.evaluate(axe.source);
        const result = await page.evaluate(async () =>
          (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          }),
        );
        expect(
          result.violations.map(({ id, nodes }) => ({
            id,
            targets: nodes.map(({ target }) => target),
          })),
        ).toEqual([]);
      }
    }
  });

  test("企业划拨校验金额并保留失败输入，响应丢失刷新恢复原品牌，核对不重复划拨", async ({
    page,
  }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (entry) => {
      if (
        entry.type() === "error" &&
        /content security policy|hydration|validateDOMNesting|Warning:/i.test(
          entry.text(),
        )
      )
        runtimeErrors.push(entry.text());
    });
    await makeEnterpriseAdministrator();
    await mockBusinessApis(page);
    await page.route("**/api/v1/balance-transactions?**", (route) =>
      route.continue(),
    );
    let reject = true,
      confirmationFails = true,
      readFails = false;
    const commands: Array<{
      organizationId: string;
      brandId: string;
      amount: number;
      idempotencyKey: string;
    }> = [];
    await page.route("**/api/v1/balance-allocations", async (route) => {
      commands.push(route.request().postDataJSON());
      if (reject)
        return route.fulfill({
          status: 422,
          json: {
            error: {
              code: "INSUFFICIENT_BALANCE",
              message: "企业可分配余额不足",
            },
          },
        });
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      await route.abort();
    });
    await page.route(
      "**/api/v1/balance-allocations/confirmation?**",
      (route) =>
        confirmationFails
          ? route.fulfill({
              status: 503,
              json: {
                error: { code: "QA_UNAVAILABLE", message: "核对暂时不可用" },
              },
            })
          : route.continue(),
    );
    await page.route("**/api/v1/balances?**", (route) =>
      readFails
        ? route.fulfill({
            status: 503,
            json: {
              error: {
                code: "QA_UNAVAILABLE",
                message: "划拨已保存但资产暂时无法刷新",
              },
            },
          })
        : route.continue(),
    );
    await page.goto(scopedPath("/dashboard/balances"));
    const allocation = page
      .locator(".ant-card")
      .filter({ has: page.getByText("企业资产划拨", { exact: true }) });
    const amount = allocation.getByLabel("划拨数量", { exact: true });
    await amount.fill("1.4");
    await allocation
      .getByRole("button", { name: "确认划拨", exact: true })
      .click();
    await expect(
      allocation.getByText("积分须为 1 至 10 亿的整数", { exact: true }),
    ).toBeVisible();
    await expect(amount).toHaveValue("1.4");
    expect(commands).toHaveLength(0);
    await amount.fill("17");
    await allocation
      .getByRole("button", { name: "确认划拨", exact: true })
      .click();
    await expect(
      allocation.getByText("企业可分配余额不足", { exact: true }),
    ).toBeVisible();
    await expect(amount).toHaveValue("17");
    reject = false;
    await allocation
      .getByRole("button", { name: "确认划拨", exact: true })
      .click();
    await expect(
      allocation.getByRole("button", { name: "核对操作结果", exact: true }),
    ).toBeVisible();
    await expect(
      allocation.getByRole("button", { name: "确认划拨", exact: true }),
    ).not.toBeVisible();
    expect(commands).toHaveLength(2);
    await page.reload();
    await expect(
      allocation.getByText("已恢复上次尚未核实的划拨，请先核对操作结果。", {
        exact: true,
      }),
    ).toBeVisible();
    await page.goto(scopedPath("/dashboard/balances", 1));
    await expect(
      allocation.getByText(fixture.scopes[0].brandId, { exact: true }),
    ).toBeVisible();
    for (const theme of ["light", "dark"]) {
      if ((await page.locator("html").getAttribute("data-theme")) !== theme)
        await page.getByRole("button", { name: "切换亮暗色模式" }).click();
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          )
          .toBeTruthy();
        await page.evaluate(async () => {
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (a) => a.effect?.getComputedTiming().iterations !== Infinity,
              )
              .map((a) => a.finished.catch(() => {})),
          );
        });
        await page.evaluate(axe.source);
        const scan = await page.evaluate(() =>
          (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          }),
        );
        expect(
          scan.violations.map(({ id, nodes }) => ({
            id,
            targets: nodes.map((n) => n.target),
          })),
        ).toEqual([]);
        if (width === 390) {
          await allocation.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: test
              .info()
              .outputPath(`brand-allocation-pending-${theme}.png`),
          });
        }
      }
    }
    confirmationFails = false;
    readFails = true;
    await allocation
      .getByRole("button", { name: "核对操作结果", exact: true })
      .click();
    await expect(
      page.getByText(
        `${fixture.scopes[0].name}已向${fixture.scopes[0].name}划拨17 积分`,
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText("划拨已保存但资产暂时无法刷新", { exact: true }),
    ).toBeVisible();
    await expect(
      allocation.getByRole("button", { name: "核对操作结果", exact: true }),
    ).not.toBeVisible();
    const { db, balanceAccounts, balanceTransactions, operationLogs } =
      database;
    const { and, eq } = operators;
    const saved = await db
      .select()
      .from(balanceTransactions)
      .where(
        and(
          eq(
            balanceTransactions.organizationId,
            fixture.scopes[0].organizationId,
          ),
          eq(balanceTransactions.operation, "allocate"),
        ),
      );
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      amount: 17,
      idempotencyKey: commands[1].idempotencyKey,
      reason: "企业向品牌划拨",
    });
    const accounts = await db
      .select()
      .from(balanceAccounts)
      .where(
        and(
          eq(balanceAccounts.organizationId, fixture.scopes[0].organizationId),
          eq(balanceAccounts.asset, "answerbit_points"),
        ),
      );
    expect(accounts.find((a) => !a.brandId)?.balance).toBe(83);
    expect(accounts.find((a) => a.brandId)?.balance).toBe(1017);
    expect(
      await db
        .select()
        .from(operationLogs)
        .where(eq(operationLogs.resourceId, saved[0].id)),
    ).toHaveLength(1);
    expect(commands).toHaveLength(2);
    readFails = false;
    await page
      .getByRole("button", { name: "重试读取资产", exact: true })
      .click();
    await expect(
      page.getByText("资产读取失败", { exact: true }),
    ).not.toBeVisible();
    const wrongBrand = await page.request.get(
      `/api/v1/balance-allocations/confirmation?organizationId=${fixture.scopes[0].organizationId}&brandId=${fixture.scopes[1].brandId}&idempotencyKey=${commands[1].idempotencyKey}`,
    );
    expect(wrongBrand.status()).toBe(404);
    expect(runtimeErrors).toEqual([]);
  });

  test("人民币划拨拒绝静默舍入，未保存原请求可同键重试，品牌角色不能划拨或核对", async ({
    page,
  }) => {
    await makeEnterpriseAdministrator();
    await mockBusinessApis(page);
    await page.route("**/api/v1/balance-transactions?**", (route) =>
      route.continue(),
    );
    await page.route("**/api/v1/balance-allocations/confirmation?**", (route) =>
      route.continue(),
    );
    let interrupted = true;
    const commands: Array<{ amount: number; idempotencyKey: string }> = [];
    await page.route("**/api/v1/balance-allocations", async (route) => {
      commands.push(route.request().postDataJSON());
      if (interrupted) return route.abort();
      return route.continue();
    });
    await page.goto(scopedPath("/dashboard/balances"));
    const allocation = page
      .locator(".ant-card")
      .filter({ has: page.getByText("企业资产划拨", { exact: true }) });
    await allocation
      .getByRole("combobox", { name: "资产类型", exact: true })
      .press("ArrowDown");
    await page
      .getByText("发布人民币余额（元）", { exact: true })
      .last()
      .click();
    await allocation.getByLabel("划拨数量", { exact: true }).fill("1.255");
    await allocation
      .getByRole("button", { name: "确认划拨", exact: true })
      .click();
    await expect(
      allocation.getByText("金额须为 0.01 至 1000 万元，最多两位小数", {
        exact: true,
      }),
    ).toBeVisible();
    expect(commands).toHaveLength(0);
    await allocation.getByLabel("划拨数量", { exact: true }).fill("1.25");
    await allocation
      .getByRole("button", { name: "确认划拨", exact: true })
      .click();
    await expect(
      allocation.getByRole("button", { name: "按原内容重试", exact: true }),
    ).toBeVisible();
    await expect(
      allocation.getByText("1.25 元", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await allocation
      .getByRole("button", { name: "核对操作结果", exact: true })
      .click();
    interrupted = false;
    await allocation
      .getByRole("button", { name: "按原内容重试", exact: true })
      .click();
    await expect(
      page.getByText(
        `${fixture.scopes[0].name}已向${fixture.scopes[0].name}划拨1.25 元`,
        { exact: true },
      ),
    ).toBeVisible();
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    expect(commands[0].amount).toBe(125);
    const {
        db,
        balanceAccounts,
        balanceTransactions,
        organizationMembers,
        memberRoles,
      } = database,
      { eq, and } = operators;
    const accounts = await db
      .select()
      .from(balanceAccounts)
      .where(
        and(
          eq(balanceAccounts.organizationId, fixture.scopes[0].organizationId),
          eq(balanceAccounts.asset, "publication_cny"),
        ),
      );
    expect(accounts.find((a) => !a.brandId)?.balance).toBe(875);
    expect(accounts.find((a) => a.brandId)?.balance).toBe(10125);
    expect(
      await db
        .select()
        .from(balanceTransactions)
        .where(
          and(
            eq(
              balanceTransactions.organizationId,
              fixture.scopes[0].organizationId,
            ),
            eq(balanceTransactions.operation, "allocate"),
          ),
        ),
    ).toHaveLength(1);
    const members = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, fixture.userId));
    await db.delete(memberRoles).where(
      operators.inArray(
        memberRoles.memberId,
        members.map((m) => m.id),
      ),
    );
    const input = {
      organizationId: fixture.scopes[0].organizationId,
      brandId: fixture.scopes[0].brandId,
      asset: "publication_cny",
      amount: 125,
      idempotencyKey: commands[0].idempotencyKey,
    };
    expect(
      (
        await page.request.post("/api/v1/balance-allocations", { data: input })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.get(
          `/api/v1/balance-allocations/confirmation?${new URLSearchParams({ organizationId: input.organizationId, brandId: input.brandId, idempotencyKey: input.idempotencyKey })}`,
        )
      ).status(),
    ).toBe(403);
  });

  test("资产划拨切换企业不显示旧余额，迟到读取隔离，失败保留金额并在明暗主题与多尺寸重试", async ({
    page,
  }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (entry) => {
      if (
        entry.type() === "error" &&
        /content security policy|hydration|validateDOMNesting|Warning:/i.test(
          entry.text(),
        )
      )
        runtimeErrors.push(entry.text());
    });
    await makeEnterpriseAdministrator();
    await mockBusinessApis(page);
    await page.route("**/api/v1/balance-transactions?**", (route) =>
      route.continue(),
    );
    const [first, second] = fixture.scopes;
    await database.db
      .update(database.balanceAccounts)
      .set({ balance: 111 })
      .where(
        operators.and(
          operators.eq(
            database.balanceAccounts.organizationId,
            first.organizationId,
          ),
          operators.isNull(database.balanceAccounts.brandId),
          operators.eq(database.balanceAccounts.asset, "answerbit_points"),
        ),
      );
    await database.db
      .update(database.balanceAccounts)
      .set({ balance: 222 })
      .where(
        operators.and(
          operators.eq(
            database.balanceAccounts.organizationId,
            second.organizationId,
          ),
          operators.isNull(database.balanceAccounts.brandId),
          operators.eq(database.balanceAccounts.asset, "answerbit_points"),
        ),
      );
    let fail = false,
      held = false,
      release!: () => void,
      reached!: () => void,
      done!: () => void;
    const gate = new Promise<void>((r) => {
        release = r;
      }),
      arrived = new Promise<void>((r) => {
        reached = r;
      }),
      completed = new Promise<void>((r) => {
        done = r;
      });
    await page.route("**/api/v1/balances?**", async (route) => {
      if (fail)
        return route.fulfill({
          status: 503,
          json: {
            error: { code: "QA_UNAVAILABLE", message: "余额读取暂时失败" },
          },
        });
      if (
        !held &&
        new URL(route.request().url()).searchParams.get("organizationId") ===
          first.organizationId
      ) {
        held = true;
        const response = await route.fetch();
        reached();
        await gate;
        await route.fulfill({ response }).catch(() => {});
        done();
        return;
      }
      return route.continue();
    });
    await page.goto(scopedPath("/dashboard/balances"));
    await arrived;
    await page
      .getByRole("combobox", { name: "企业", exact: true })
      .press("ArrowDown");
    await page
      .locator(".ant-select-item-option")
      .filter({ hasText: second.name })
      .click();
    await expect(
      page.locator(".ant-statistic-content").filter({ hasText: "222" }),
    ).toBeVisible();
    release();
    await completed;
    await expect(
      page.locator(".ant-statistic-content").filter({ hasText: "111" }),
    ).not.toBeVisible();
    const allocation = page
      .locator(".ant-card")
      .filter({ has: page.getByText("企业资产划拨", { exact: true }) });
    await allocation.getByLabel("划拨数量", { exact: true }).fill("23");
    fail = true;
    await page.getByRole("button", { name: "刷新资产", exact: true }).click();
    await expect(
      page.getByText("余额读取暂时失败", { exact: true }),
    ).toBeVisible();
    await expect(
      allocation.getByLabel("划拨数量", { exact: true }),
    ).toHaveValue("23");
    expect(
      await page.locator(".ant-statistic-content").allTextContents(),
    ).toEqual(["—", "—", "—", "—"]);
    for (const theme of ["light", "dark"]) {
      if ((await page.locator("html").getAttribute("data-theme")) !== theme)
        await page.getByRole("button", { name: "切换亮暗色模式" }).click();
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          )
          .toBeTruthy();
        const overflowState = await page.evaluate(() => ({
          viewport: innerWidth,
          document: document.documentElement.scrollWidth,
          elements: [...document.querySelectorAll<HTMLElement>("body *")]
            .filter(
              (element) =>
                element.getBoundingClientRect().right > innerWidth + 1 &&
                element.clientWidth > 0,
            )
            .slice(0, 15)
            .map((element) => ({
              tag: element.tagName,
              class: element.className,
              right: element.getBoundingClientRect().right,
              width: element.clientWidth,
            })),
        }));
        expect(
          overflowState.document,
          JSON.stringify(overflowState),
        ).toBeLessThanOrEqual(overflowState.viewport);
        await page.evaluate(async () => {
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (a) => a.effect?.getComputedTiming().iterations !== Infinity,
              )
              .map((a) => a.finished.catch(() => {})),
          );
        });
        await page.evaluate(axe.source);
        const scan = await page.evaluate(() =>
          (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          }),
        );
        expect(
          scan.violations.map(({ id, nodes }) => ({
            id,
            targets: nodes.map((n) => n.target),
          })),
        ).toEqual([]);
        if (width === 390) {
          await allocation.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: test.info().outputPath(`brand-allocation-${theme}.png`),
            fullPage: true,
          });
        }
      }
    }
    fail = false;
    await page
      .getByRole("button", { name: "重试读取资产", exact: true })
      .click();
    await expect(
      page.locator(".ant-statistic-content").filter({ hasText: "222" }),
    ).toBeVisible();
    await database.db
      .update(database.organizations)
      .set({ pointsExpiresAt: new Date("2020-01-01") })
      .where(operators.eq(database.organizations.id, second.organizationId));
    await page.goto(scopedPath("/dashboard/balances", 1));
    await expect(
      page.getByText("企业积分已到期", { exact: true }),
    ).toBeVisible();
    await expect(
      allocation.getByRole("button", { name: "确认划拨", exact: true }),
    ).toBeDisabled();
    await allocation
      .getByRole("combobox", { name: "资产类型", exact: true })
      .press("ArrowDown");
    await page
      .getByText("发布人民币余额（元）", { exact: true })
      .last()
      .click();
    await expect(
      allocation.getByRole("button", { name: "确认划拨", exact: true }),
    ).toBeEnabled();
    expect(runtimeErrors).toEqual([]);
  });

  test("企业管理员查看整体消耗并切换品牌，品牌角色无法越权，明暗主题与多尺寸可用", async ({
    page,
  }) => {
    const {
      db,
      users,
      roles,
      organizationMembers,
      memberRoles,
      grantBalance,
      allocateBalance,
      consumeBalance,
      restoreBalance,
    } = database;
    const { eq, and } = operators;
    const target = fixture.scopes[0];
    await db
      .update(users)
      .set({ accountType: "agent", pricingTier: "bronze" })
      .where(eq(users.id, fixture.userId));
    const [member] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, target.organizationId),
          eq(organizationMembers.userId, fixture.userId),
        ),
      );
    const [role] = await db
      .select()
      .from(roles)
      .where(eq(roles.code, "tenant_admin"));
    await db
      .insert(memberRoles)
      .values({ memberId: member.id, roleId: role.id });
    await grantBalance({
      organizationId: target.organizationId,
      asset: "answerbit_points",
      amount: 500,
      reason: "QA 企业积分入账",
      actorUserId: fixture.userId,
      idempotencyKey: randomUUID(),
    });
    await allocateBalance({
      organizationId: target.organizationId,
      brandId: target.brandId,
      asset: "answerbit_points",
      amount: 200,
      reason: "QA 企业品牌划拨",
      actorUserId: fixture.userId,
      idempotencyKey: randomUUID(),
    });
    const usage = {
      organizationId: target.organizationId,
      brandId: target.brandId,
      asset: "answerbit_points" as const,
      amount: 40,
      referenceType: "feature_usage",
      referenceId: "qa-point-usage",
      reason: "QA 功能消耗",
      actorUserId: fixture.userId,
      idempotencyKey: randomUUID(),
    };
    await consumeBalance(usage);
    await restoreBalance({
      ...usage,
      amount: 10,
      referenceType: "feature_usage_failed",
      reason: "QA 失败返还",
      idempotencyKey: randomUUID(),
    });
    await mockBusinessApis(page);
    await page.addInitScript({ content: axe.source });
    await page.goto(
      `/dashboard/metering?organizationId=${target.organizationId}`,
    );
    await expect(
      page.getByText("企业品牌可用积分合计", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".ant-statistic-content").first()).toContainText(
      "1,170",
    );
    await expect(
      page.getByText("企业可分配积分", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("周期净消耗 30 积分", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("QA 功能消耗", { exact: true })).toBeVisible();
    await expect(page.getByText("QA 失败返还", { exact: true })).toBeVisible();
    const params = new URLSearchParams({
      organizationId: target.organizationId,
      beginDate: "2020-01-01",
      endDate: "2100-01-01",
      operation: "consume",
    });
    const result = await page.request.get(`/api/v1/point-usage?${params}`);
    expect(result.ok()).toBeTruthy();
    expect((await result.json()).data).toMatchObject({
      balance: 1170,
      organizationBalance: 300,
      summary: { consumed: 40, restored: 10 },
      pagination: { total: 1 },
    });
    for (const theme of ["light", "dark"]) {
      if (theme === "dark")
        await page.getByRole("button", { name: "切换亮暗色模式" }).click();
      await expect
        .poll(() => page.locator("html").getAttribute("data-theme"))
        .toBe(theme);
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
      await expect
        .poll(() =>
          page
            .getByRole("columnheader", { name: "发生时间（北京时间）" })
            .evaluate((element) => getComputedStyle(element).color),
        )
        .toBe(theme === "dark" ? "rgb(244, 245, 247)" : "rgb(55, 59, 69)");
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.effect?.getComputedTiming().iterations !== Infinity,
            )
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      const violations = await page.evaluate(async () =>
        (
          await (window as typeof window & { axe: typeof axe }).axe.run(
            document,
            {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
              },
            },
          )
        ).violations.map(({ id, nodes }) => ({
          id,
          targets: nodes.map(({ target, failureSummary }) => ({
            target: target.join(" "),
            failureSummary,
          })),
        })),
      );
      expect(violations).toEqual([]);
    }
    await page.getByText("当前品牌", { exact: true }).click();
    await expect(
      page.getByText("当前品牌可用积分", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("企业品牌可用积分合计", { exact: true }),
    ).toHaveCount(0);
    // The same account is a brand administrator in enterprise B.
    const denied = await page.request.get(
      `/api/v1/point-usage?${new URLSearchParams({ organizationId: fixture.scopes[1].organizationId, beginDate: "2020-01-01", endDate: "2100-01-01" })}`,
    );
    expect(denied.status()).toBe(403);
    await db.delete(memberRoles).where(eq(memberRoles.memberId, member.id));
    // Also cover legacy data that stored a brand role at the enterprise level.
    const [legacyRole] = await db
      .select()
      .from(roles)
      .where(eq(roles.code, "brand_admin"));
    await db
      .insert(memberRoles)
      .values({ memberId: member.id, roleId: legacyRole.id });

    await page.reload();
    await expect(
      page.getByText("当前品牌可用积分", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("企业整体", { exact: true })).toHaveCount(0);
    await expect(page.getByText("企业可分配积分", { exact: true })).toHaveCount(
      0,
    );
    const revoked = await page.request.get(`/api/v1/point-usage?${params}`);
    expect(revoked.status()).toBe(403);
    let releaseLateResponse: () => void = () => {};
    let markDone: () => void = () => {};
    let requested = false;
    const held = new Promise<void>((resolve) => {
      releaseLateResponse = resolve;
    });
    const done = new Promise<void>((resolve) => {
      markDone = resolve;
    });
    await page.route("**/api/v1/point-usage?**", async (route) => {
      if (
        new URL(route.request().url()).searchParams.get("organizationId") !==
        target.organizationId
      )
        return route.continue();
      const response = await route.fetch();
      requested = true;
      await held;
      await route.fulfill({ response }).catch(() => {});
      markDone();
    });
    await page.getByRole("button", { name: "刷新数据" }).click();
    await expect.poll(() => requested).toBe(true);
    await page
      .getByRole("combobox", { name: "企业", exact: true })
      .press("ArrowDown");
    await page
      .getByText(fixture.scopes[1].name, { exact: true })
      .last()
      .click();
    await expect(page.locator(".ant-statistic-content").first()).toContainText(
      "1,000",
    );
    await expect(page.getByText("QA 功能消耗", { exact: true })).toHaveCount(0);
    releaseLateResponse();
    await done;
    await expect(page.locator(".ant-statistic-content").first()).toContainText(
      "1,000",
    );
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

  test("回答切换企业会清除旧列表、筛选和迟到详情，引用失败仍能看回答", async ({
    page,
  }) => {
    await mockBusinessApis(page);
    let releaseDetail: () => void = () => {};
    let detailRequested = false;
    const held = new Promise<void>((resolve) => {
      releaseDetail = resolve;
    });
    await mockAnswerReads(page, async (route) => {
      detailRequested = true;
      await held;
      await fulfill(route, {
        query: "旧企业详情",
        llm_output: "不应出现",
        links: [],
      }).catch(() => {});
    });
    await page.route("**/api/v1/answerbit/citations/domains**", (route) =>
      route.fulfill({
        status: 503,
        json: { error: { message: "引用数据暂时不可用" } },
      }),
    );
    await page.goto(scopedPath("/dashboard/answers"));
    await expect(
      page.getByText("流程测试企业 A 的回答", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/引用域名：引用数据暂时不可用/)).toBeVisible();
    await page.getByPlaceholder("问题、文章或域名").fill("旧企业条件");
    await page.getByRole("button", { name: /查\s*看/ }).click();
    await expect.poll(() => detailRequested).toBeTruthy();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /close|关闭/i })
      .click();
    await page.locator("#answerbit-scope-organization").focus();
    await page.locator("#answerbit-scope-organization").press("ArrowDown");
    await page.getByTitle("流程测试企业 B", { exact: true }).click();
    releaseDetail();
    await expect(
      page.getByText("流程测试企业 B 的回答", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("流程测试企业 A 的回答", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByPlaceholder("问题、文章或域名")).toHaveValue("");
    await expect(page.getByText("旧企业详情", { exact: true })).toHaveCount(0);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBeTruthy();
    }
  });

  test("保存的个人视图支持恢复、重命名和删除，GEO 权限不依赖内容模块", async ({
    page,
  }) => {
    const { db, organizationUserFeatureScopes } = database;
    await db.insert(organizationUserFeatureScopes).values(
      fixture.scopes.map((scope) => ({
        organizationId: scope.organizationId,
        userId: fixture.userId,
        features: ["geo_insights" as const],
      })),
    );
    await mockBusinessApis(page);
    await mockAnswerReads(page);
    await page.goto(scopedPath("/dashboard/answers"));
    await expect(
      page.getByText("流程测试企业 A 的回答", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /回答\s*CSV/ })).toHaveCount(
      0,
    );
    await page.getByPlaceholder("问题、文章或域名").fill("选购问题");
    await page.getByRole("button", { name: "保存当前条件" }).click();
    await page.getByLabel("视图名称", { exact: true }).fill("每周分析");
    await page.getByRole("button", { name: /^保\s*存$/ }).click();
    await expect(
      page.getByRole("button", { name: "每周分析", exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "每周分析", exact: true }).click();
    await expect(page.getByPlaceholder("问题、文章或域名")).toHaveValue(
      "选购问题",
    );
    await page
      .getByRole("button", { name: "重命名视图 每周分析", exact: true })
      .click();
    await page.getByLabel("视图名称", { exact: true }).fill("本周客户分析");
    await page.getByRole("button", { name: /^保\s*存$/ }).click();
    await expect(
      page.getByRole("button", { name: "本周客户分析", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "删除视图 本周客户分析", exact: true })
      .click();
    await page.getByRole("button", { name: /^删\s*除$/ }).click();
    await expect(
      page.getByRole("button", { name: "本周客户分析", exact: true }),
    ).toHaveCount(0);
    const views = await page.request.get(
      `/api/v1/saved-views?organizationId=${fixture.scopes[0].organizationId}&page=answers`,
    );
    expect((await views.json()).data).toEqual([]);
  });

  for (const mode of ["响应丢失", "执行中切换"] as const) {
    test(`报告原请求${mode}后保留原条件与键，真实队列和额度只创建一次`, async ({
      page,
    }) => {
      const target = fixture.scopes[0];
      const [version] = await database.db
        .select()
        .from(database.billingPlanVersions)
        .limit(1);
      const periodStart = new Date(Date.now() - 86_400_000),
        periodEnd = new Date(Date.now() + 86_400_000);
      const [subscription] = await database.db
        .insert(database.platformSubscriptions)
        .values({
          organizationId: target.organizationId,
          planVersionId: version.id,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        })
        .returning();
      const [entitlement] = await database.db
        .insert(database.subscriptionEntitlements)
        .values({
          organizationId: target.organizationId,
          subscriptionId: subscription.id,
          entitlementKey: "report_exports",
          limitAmount: 3,
          unit: "次",
          periodStart,
          periodEnd,
        })
        .returning();
      await mockBusinessApis(page, (route) => route.continue());
      await mockAnswerReads(page);
      await page.route("**/api/v1/report-exports?**", (route) =>
        route.continue(),
      );
      const keys: string[] = [],
        payloads: Record<string, unknown>[] = [];
      let jobId = "",
        committed = false;
      let release: () => void = () => {};
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/v1/report-exports", async (route) => {
        keys.push(route.request().headers()["idempotency-key"]);
        payloads.push(route.request().postDataJSON());
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        const job = (await response.json()).data;
        if (!jobId) jobId = job.id;
        if (keys.length === 1) {
          committed = true;
          if (mode === "响应丢失") return route.abort("failed");
          await waiting;
        }
        return route.fulfill({ response }).catch(() => {});
      });
      await page.goto(scopedPath("/dashboard/answers"));
      const fresh = page.getByRole("button", { name: /^回答\s*CSV$/ });
      await expect(fresh).toBeEnabled();
      await page.getByPlaceholder("问题、文章或域名").fill("原报告完整条件");
      await fresh.click();
      await expect.poll(() => committed).toBe(true);
      const confirm = page.getByRole("button", {
        name: "确认原导出 · 回答 CSV",
        exact: true,
      });
      if (mode === "响应丢失") await expect(confirm).toBeEnabled();
      else await expect(confirm).toBeDisabled();
      await expect(fresh).toBeDisabled();
      // Switch away and return without replacing or repeating the original request.
      for (const letter of ["B", "A"]) {
        await page.locator("#answerbit-scope-organization").focus();
        await page.locator("#answerbit-scope-organization").press("ArrowDown");
        await page
          .getByTitle(`流程测试企业 ${letter}`, { exact: true })
          .click();
        await expect(
          page.getByText(`流程测试企业 ${letter} 的回答`, { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("原关键词：原报告完整条件", { exact: true }),
        )[letter === "A" ? "toBeVisible" : "toBeHidden"]();
      }
      expect(keys).toHaveLength(1);
      if (mode === "执行中切换") {
        await expect(confirm).toBeDisabled();
        release();
        await expect(
          page.getByText("回答 CSV原导出仍在提交", { exact: true }),
        ).toBeHidden();
        await expect(
          page.getByRole("button", { name: "查看本次报告", exact: true }),
        ).toBeVisible();
      } else {
        await page.reload();
        await expect(
          page.getByText("原关键词：原报告完整条件", { exact: true }),
        ).toBeVisible();
        await page
          .getByPlaceholder("问题、文章或域名")
          .fill("继续分析的新筛选");
        for (const theme of ["light", "dark"] as const) {
          if (theme === "dark")
            await page.getByRole("button", { name: "切换亮暗色模式" }).click();
          await expect
            .poll(() => page.locator("html").getAttribute("data-theme"))
            .toBe(theme);
          for (const width of [390, 768, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.evaluate(async () => {
              await Promise.all(
                document
                  .getAnimations()
                  .filter(
                    (a) =>
                      a.effect?.getComputedTiming().iterations !== Infinity,
                  )
                  .map((a) => a.finished.catch(() => {})),
              );
            });
            await expect
              .poll(() =>
                page.evaluate(() => document.documentElement.scrollWidth),
              )
              .toBeLessThanOrEqual(width);
            await page.evaluate(axe.source);
            const result = await page.evaluate(async () =>
              (window as unknown as { axe: typeof axe }).axe.run(document, {
                runOnly: {
                  type: "tag",
                  values: ["wcag2a", "wcag2aa", "wcag21aa"],
                },
              }),
            );
            expect(result.violations).toEqual([]);
          }
        }
        await database.db
          .update(database.brandAccess)
          .set({ role: "brand_viewer" })
          .where(
            operators.and(
              operators.eq(
                database.brandAccess.organizationId,
                target.organizationId,
              ),
              operators.eq(database.brandAccess.userId, fixture.userId),
            ),
          );
        await page
          .getByRole("button", { name: "刷新品牌范围", exact: true })
          .click();
        await expect(confirm).toBeDisabled();
        await expect(
          page.getByText(
            "当前没有报告导出权限，原记录已保留；恢复权限后可继续确认。",
            { exact: true },
          ),
        ).toBeVisible();
        const denied = await page.request.post("/api/v1/report-exports", {
          headers: { "Idempotency-Key": keys[0] },
          data: payloads[0],
        });
        expect(denied.status()).toBe(403);
        await database.db
          .update(database.brandAccess)
          .set({ role: "brand_admin" })
          .where(
            operators.and(
              operators.eq(
                database.brandAccess.organizationId,
                target.organizationId,
              ),
              operators.eq(database.brandAccess.userId, fixture.userId),
            ),
          );
        await page
          .getByRole("button", { name: "重新检查权限", exact: true })
          .click();
        await expect(confirm).toBeEnabled();
        await confirm.click();
        await expect(confirm).toBeHidden();
        expect(keys).toHaveLength(2);
        expect(keys[1]).toBe(keys[0]);
        expect(payloads[1]).toEqual(payloads[0]);
        await expect(page.getByPlaceholder("问题、文章或域名")).toHaveValue(
          "继续分析的新筛选",
        );
      }
      const jobs = await database.db
        .select()
        .from(database.reportExports)
        .where(
          operators.eq(
            database.reportExports.organizationId,
            target.organizationId,
          ),
        );
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        id: jobId,
        idempotencyKey: keys[0],
        status: "queued",
        filters: { keyword: "原报告完整条件" },
      });
      const [saved] = await database.db
        .select()
        .from(database.subscriptionEntitlements)
        .where(
          operators.eq(database.subscriptionEntitlements.id, entitlement.id),
        );
      expect(saved.reservedAmount).toBe(1);
      const audits = await database.db
        .select()
        .from(database.operationLogs)
        .where(
          operators.and(
            operators.eq(
              database.operationLogs.organizationId,
              target.organizationId,
            ),
            operators.eq(
              database.operationLogs.operation,
              "report-export.create",
            ),
          ),
        );
      expect(audits).toHaveLength(1);
      const queued = await database.pool.query<{ count: number }>(
        "select count(*)::int as count from pgboss.job where name = 'report-export' and data->>'exportId' = $1",
        [jobId],
      );
      expect(queued.rows[0].count).toBe(1);
      await page
        .getByRole("button", { name: "查看本次报告", exact: true })
        .click();
      await expect(
        page
          .getByRole("region", { name: "报告记录", exact: true })
          .getByText("等待生成", { exact: true }),
      ).toBeVisible();
    });
  }

  test("报告暂存失败不写入，明确拒绝可修正，未知响应和后续拒绝保留原请求", async ({
    page,
  }) => {
    const keys: string[] = [],
      payloads: Record<string, unknown>[] = [];
    await mockBusinessApis(page, async (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      payloads.push(route.request().postDataJSON());
      if (keys.length === 1)
        return route.fulfill({
          status: 422,
          json: { error: { message: "测试输入被拒绝" } },
        });
      if (keys.length === 2) return fulfill(route, { status: "queued" });
      if (keys.length === 3)
        return route.fulfill({
          status: 403,
          json: { error: { message: "测试权限已变更" } },
        });
      const payload = payloads.at(-1)!;
      return fulfill(route, {
        id: randomUUID(),
        reportType: payload.reportType,
        status: "queued",
        filters: payload,
        downloadUrl: null,
      });
    });
    await mockAnswerReads(page);
    await page.goto(scopedPath("/dashboard/answers"));
    const fresh = page.getByRole("button", { name: /^回答\s*CSV$/ });
    await expect(fresh).toBeEnabled();
    await page.getByPlaceholder("问题、文章或域名").fill("第一次输入");
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      (
        window as unknown as { restoreReportStorage: () => void }
      ).restoreReportStorage = () => {
        Storage.prototype.setItem = original;
      };
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("geo.report.")) throw new Error("QA storage denied");
        return original.call(this, key, value);
      };
    });
    await fresh.click();
    await expect(
      page.getByText(
        "无法暂存本次导出，尚未发送请求；请恢复浏览器存储后再试。",
        { exact: true },
      ),
    ).toBeVisible();
    expect(keys).toHaveLength(0);
    await page.evaluate(() =>
      (
        window as unknown as { restoreReportStorage: () => void }
      ).restoreReportStorage(),
    );
    await fresh.click();
    await expect(
      page.getByText("测试输入被拒绝", { exact: true }),
    ).toBeVisible();
    await expect(fresh).toBeEnabled();
    await page.getByPlaceholder("问题、文章或域名").fill("修正后的原条件");
    await fresh.click();
    const confirm = page.getByRole("button", {
      name: "确认原导出 · 回答 CSV",
      exact: true,
    });
    await expect(confirm).toBeEnabled();
    expect(keys[1]).not.toBe(keys[0]);
    await page
      .getByPlaceholder("问题、文章或域名")
      .fill("不能替换的后续分析条件");
    await confirm.click();
    await expect(
      page.getByText("测试权限已变更", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("原关键词：修正后的原条件", { exact: true }),
    ).toBeVisible();
    expect(keys[2]).toBe(keys[1]);
    expect(payloads[2]).toEqual(payloads[1]);
    await page.reload();
    await expect(
      page.getByText("原关键词：修正后的原条件", { exact: true }),
    ).toBeVisible();
    await confirm.click();
    await expect(confirm).toBeHidden();
    expect(keys[3]).toBe(keys[1]);
    expect(payloads[3]).toEqual(payloads[1]);
    await fresh.click();
    await expect.poll(() => keys.length).toBe(5);
    expect(keys[4]).not.toBe(keys[1]);
  });

  test("报告网络失败后刷新重试保留同一键，过期报告按原筛选重新导出", async ({
    page,
  }) => {
    const keys: string[] = [],
      payloads: Record<string, unknown>[] = [];
    let jobs: unknown[] = [];
    await mockBusinessApis(page, async (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      const payload = route.request().postDataJSON();
      payloads.push(payload);
      if (keys.length === 1) return route.abort("failed");
      const job = {
        id: "report-1",
        reportType: "answers",
        filters: {
          beginDate: payload.beginDate,
          endDate: payload.endDate,
          keyword: payload.keyword,
          mentionBrand: payload.mentionBrand,
          platforms: [],
          promptIds: [],
          tagIds: [],
          titleIds: [],
        },
        status: "queued",
        filename: null,
        rowCount: null,
        downloadUrl: null,
        expiresAt: null,
        errorMessage: null,
      };
      jobs = [job];
      return fulfill(route, job);
    });
    await mockAnswerReads(page);
    await page.route("**/api/v1/report-exports?**", (route) =>
      fulfill(route, { list: jobs, pagination: { total: jobs.length } }),
    );
    await page.goto(scopedPath("/dashboard/answers"));
    await expect(
      page.getByText("流程测试企业 A 的回答", { exact: true }),
    ).toBeVisible();
    await page.getByPlaceholder("问题、文章或域名").fill("选购问题");
    await page.getByRole("button", { name: /回答\s*CSV/ }).click();
    await expect.poll(() => keys.length).toBe(1);
    await expect(
      page.getByRole("button", { name: /^回答\s*CSV$/ }),
    ).toBeDisabled();
    await page.getByPlaceholder("问题、文章或域名").fill("响应丢失后的新筛选");
    await page.reload();
    await expect(
      page.getByText("原关键词：选购问题", { exact: true }),
    ).toBeVisible();
    await page.getByPlaceholder("问题、文章或域名").fill("当前继续分析的条件");
    await page
      .getByRole("button", { name: "确认原导出 · 回答 CSV", exact: true })
      .click();
    await expect(page.getByText("等待生成", { exact: true })).toBeVisible();
    expect(keys[1]).toBe(keys[0]);
    expect(payloads[1]).toEqual(payloads[0]);
    await expect(page.getByPlaceholder("问题、文章或域名")).toHaveValue(
      "当前继续分析的条件",
    );
    expect(payloads[1]).toMatchObject({
      keyword: "选购问题",
      mentionBrand: -1,
    });
    jobs = [{ ...(jobs[0] as Record<string, unknown>), status: "expired" }];
    await page.getByRole("button", { name: /刷新任务/ }).click();
    await expect(page.getByText("文件已过期", { exact: true })).toBeVisible();
    await page.getByPlaceholder("问题、文章或域名").fill("新的筛选问题");
    await page.getByRole("button", { name: "重新导出", exact: true }).click();
    await expect.poll(() => keys.length).toBe(3);
    expect(keys[2]).not.toBe(keys[1]);
    expect(payloads[2]).toMatchObject({ keyword: "选购问题" });

    const downloadUrl = `/api/v1/report-exports/report-1/file?organizationId=${fixture.scopes[0].organizationId}`;
    const readyJob = {
      ...(jobs[0] as Record<string, unknown>),
      status: "succeeded",
      filename: "answers.csv",
      downloadUrl,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      rowCount: 1,
    };
    let fileExpired = true;
    await page.route("**/api/v1/report-exports/report-1/file?**", (route) =>
      fileExpired
        ? route.fulfill({
            status: 410,
            contentType: "application/json",
            body: JSON.stringify({
              error: { message: "文件已过期，请重新导出" },
            }),
          })
        : route.fulfill({
            status: 200,
            contentType: "text/csv",
            body: "问题,回答\n选购问题,测试回答\n",
          }),
    );
    jobs = [readyJob];
    await page.getByRole("button", { name: /刷新任务/ }).click();
    await page.getByRole("button", { name: /下\s*载/ }).click();
    await expect(
      page.getByText("文件已过期，请重新导出", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /下\s*载/ })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "重新导出", exact: true }),
    ).toBeVisible();
    fileExpired = false;
    await page.getByRole("button", { name: /刷新任务/ }).click();
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: /下\s*载/ }).click();
    expect((await downloaded).suggestedFilename()).toBe("answers.csv");
  });

  test("未保存文档跨企业和刷新可恢复，保存失败仍保留正文", async ({ page }) => {
    await mockBusinessApis(page);
    await page.route("**/api/v1/content-documents**", (route) =>
      route.continue(),
    );
    await page.route("**/api/v1/content-folders**", (route) =>
      route.continue(),
    );
    await page.goto(`${scopedPath("/dashboard/content")}&stage=library`);
    await page.getByRole("button", { name: /新建文档/ }).click();
    let editor = page.getByRole("dialog", { name: "保存到文档库" });
    await editor.getByLabel("标题", { exact: true }).fill("暂存文章 A");
    await editor.getByLabel("正文", { exact: true }).fill("尚未保存的正文");
    await editor.getByRole("button", { name: "暂存并关闭" }).click();
    await expect(editor).toHaveCount(0);
    await expect(
      page.getByText("有尚未保存的编辑", { exact: true }),
    ).toBeVisible();
    await page.locator("#answerbit-scope-organization").focus();
    await page.locator("#answerbit-scope-organization").press("ArrowDown");
    await page.getByTitle("流程测试企业 B", { exact: true }).click();
    await expect(
      page.getByText("有尚未保存的编辑", { exact: true }),
    ).toHaveCount(0);
    await page.locator("#answerbit-scope-organization").focus();
    await page.locator("#answerbit-scope-organization").press("ArrowDown");
    await page.getByTitle("流程测试企业 A", { exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "继续编辑", exact: true }).click();
    editor = page.getByRole("dialog", { name: "保存到文档库" });
    await expect(editor.getByLabel("正文", { exact: true })).toHaveValue(
      "尚未保存的正文",
    );
    let failed = false;
    await page.route("**/api/v1/content-documents", (route) => {
      if (route.request().method() === "POST" && !failed) {
        failed = true;
        return route.abort("failed");
      }
      return route.continue();
    });
    await editor.getByRole("button", { name: /保存文档|确认上次保存/ }).click();
    await expect(
      page.getByText("连接中断，编辑内容已保留，请重试", { exact: true }),
    ).toBeVisible();
    await expect(editor.getByLabel("正文", { exact: true })).toHaveValue(
      "尚未保存的正文",
    );
    await editor.getByRole("button", { name: /保存文档|确认上次保存/ }).click();
    await expect(editor).toHaveCount(0);
    await expect(
      page.getByText("有尚未保存的编辑", { exact: true }),
    ).toHaveCount(0);
    const rows = await database.db
      .select()
      .from(database.contentDocuments)
      .where(
        operators.eq(
          database.contentDocuments.organizationId,
          fixture.scopes[0].organizationId,
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "暂存文章 A",
      body: "尚未保存的正文",
    });
  });

  for (const source of ["manual", "imported"] as const) {
    test(`${source === "manual" ? "新建" : "导入"}文档成功响应丢失，刷新重试找回原文档并保留之后的编辑`, async ({
      page,
    }) => {
      await page.addInitScript({ content: axe.source });
      await mockBusinessApis(page);
      await page.route("**/api/v1/content-documents**", (route) =>
        route.continue(),
      );
      await page.route("**/api/v1/content-folders**", (route) =>
        route.continue(),
      );
      await page.goto(`${scopedPath("/dashboard/content")}&stage=library`);
      await page
        .getByRole("button", {
          name: source === "manual" ? /新建文档/ : /导入文章/,
        })
        .click();
      let editor = page.getByRole("dialog", { name: "保存到文档库" });
      await editor.getByLabel("标题", { exact: true }).fill("确认后丢失的文章");
      if (source === "manual") {
        await editor.getByLabel("状态", { exact: true }).press("ArrowDown");
        await page.getByTitle("已定稿", { exact: true }).click();
        await editor.getByRole("button", { name: /保存文档/ }).click();
        await expect(
          page.getByText("定稿文档必须包含正文", { exact: true }),
        ).toBeVisible();
        await expect(editor).toBeVisible();
      }
      await editor.getByLabel("正文", { exact: true }).fill("首次提交正文");
      if (source === "imported")
        await editor
          .getByLabel("来源链接", { exact: true })
          .fill("https://example.com/imported");
      const submissions: { key: string; body: unknown; status: number }[] = [];
      await page.route("**/api/v1/content-documents", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const response = await route.fetch();
        submissions.push({
          key: route.request().headers()["idempotency-key"],
          body: route.request().postDataJSON(),
          status: response.status(),
        });
        if (submissions.length === 1) return route.abort("failed");
        return route.fulfill({ response });
      });
      await editor.getByRole("button", { name: /保存文档/ }).click();
      await expect(
        editor.getByText("上次保存结果尚未确认", { exact: true }),
      ).toBeVisible();
      await editor
        .getByLabel("正文", { exact: true })
        .fill("响应丢失后继续修改");
      await editor.getByRole("button", { name: "暂存并关闭" }).click();
      await expect(editor).toHaveCount(0);
      await page.reload();
      await page.getByRole("button", { name: "继续编辑", exact: true }).click();
      editor = page.getByRole("dialog", { name: "保存到文档库" });
      await expect(editor.getByLabel("正文", { exact: true })).toHaveValue(
        "响应丢失后继续修改",
      );
      await editor
        .getByRole("button", { name: "确认上次保存", exact: true })
        .click();
      editor = page.getByRole("dialog", { name: /编辑文档/ });
      await expect(editor).toBeVisible();
      await expect(editor.getByLabel("正文", { exact: true })).toHaveValue(
        "响应丢失后继续修改",
      );
      expect(submissions).toHaveLength(2);
      expect(submissions[0].key).toMatch(/^[0-9a-f-]{36}$/);
      expect(submissions[0].status).toBe(201);
      expect(submissions[1]).toEqual({ ...submissions[0], status: 200 });
      const beforeSave = await database.db
        .select()
        .from(database.contentDocuments)
        .where(
          operators.eq(
            database.contentDocuments.organizationId,
            fixture.scopes[0].organizationId,
          ),
        );
      expect(beforeSave).toHaveLength(1);
      expect(beforeSave[0]).toMatchObject({
        body: "首次提交正文",
        currentVersion: 1,
      });
      await editor
        .getByRole("button", { name: "保存新版本", exact: true })
        .click();
      await expect(editor).toHaveCount(0);
      await expect(
        page.getByRole("dialog", { name: "确认后丢失的文章", exact: true }),
      ).toBeVisible();
      for (const mode of ["light", "dark"]) {
        if (mode === "dark") {
          await page
            .getByRole("dialog", { name: "确认后丢失的文章", exact: true })
            .getByRole("button", { name: /close|关闭/i })
            .click();
          await expect(
            page.getByRole("dialog", { name: "确认后丢失的文章", exact: true }),
          ).toHaveCount(0);

          await page
            .getByRole("button", { name: "切换亮暗色模式", exact: true })
            .click();
          await expect(page.locator("html")).toHaveAttribute(
            "data-theme",
            "dark",
          );
          await expect
            .poll(() =>
              page
                .locator(".ant-menu-item-group-title")
                .first()
                .evaluate((element) => getComputedStyle(element).color),
            )
            .toBe("rgb(165, 175, 191)");
        }
        const violations = await page.evaluate(async () => {
          const result = await (
            window as typeof window & { axe: typeof axe }
          ).axe.run(document, {
            runOnly: {
              type: "tag",
              values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
            },
          });
          return result.violations.map(({ id, nodes }) => ({
            id,
            targets: nodes.map(({ target }) => target.join(" ")),
          }));
        });
        expect(violations).toEqual([]);
      }
      const rows = await database.db
        .select()
        .from(database.contentDocuments)
        .where(
          operators.eq(
            database.contentDocuments.organizationId,
            fixture.scopes[0].organizationId,
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        body: "响应丢失后继续修改",
        currentVersion: 2,
      });
      const versions = await database.db
        .select()
        .from(database.contentDocumentVersions)
        .where(
          operators.eq(database.contentDocumentVersions.documentId, rows[0].id),
        );
      expect(versions).toHaveLength(2);
      expect(versions.map((version) => version.body)).toEqual(
        expect.arrayContaining(["首次提交正文", "响应丢失后继续修改"]),
      );
      const audits = await database.db
        .select()
        .from(database.operationLogs)
        .where(operators.eq(database.operationLogs.resourceId, rows[0].id));
      expect(
        audits.filter((log) => log.operation === "content.document.create"),
      ).toHaveLength(1);
    });
  }

  test("多人编辑冲突保留表单，合并保存后仍保留两人的历史内容", async ({
    page,
  }) => {
    await page.addInitScript({ content: axe.source });
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (entry) => {
      if (
        entry.type() === "error" &&
        /content security policy|hydration|validateDOMNesting/i.test(
          entry.text(),
        )
      )
        runtimeErrors.push(entry.text());
    });
    page.on("requestfailed", (request) => {
      if (new URL(request.url()).pathname.startsWith("/_next/static/"))
        runtimeErrors.push("静态资源加载失败");
    });
    await mockBusinessApis(page);
    await page.route("**/api/v1/content-documents**", (route) =>
      route.continue(),
    );
    await page.route("**/api/v1/content-folders**", (route) =>
      route.continue(),
    );
    await page.goto(`${scopedPath("/dashboard/content")}&stage=library`);
    const { organizationId, teamBindingId, brandId } = fixture.scopes[0];
    const scope = { organizationId, teamBindingId, brandId };
    const headers = { Origin: new URL(page.url()).origin };
    const created = await page.request.post("/api/v1/content-documents", {
      headers,
      data: { ...scope, title: "协作文章", body: "初稿" },
    });
    expect(created.status()).toBe(201);
    const doc = (await created.json()).data;
    await page.getByRole("button", { name: /刷新$/ }).first().click();
    await page.getByText("协作文章", { exact: true }).first().click();
    await page.getByRole("button", { name: /编\s*辑/ }).click();
    let editor = page.getByRole("dialog", { name: /编辑文档/ });
    await editor.getByLabel("正文", { exact: true }).fill("我的补充");
    const concurrent = await page.request.patch(
      `/api/v1/content-documents/${doc.id}`,
      { headers, data: { ...scope, expectedVersion: 1, body: "同事的补充" } },
    );
    expect(concurrent.status()).toBe(200);
    await editor
      .getByRole("button", { name: "保存新版本", exact: true })
      .click();
    await expect(
      editor.getByText("文档已有新版本，你的编辑内容仍在这里", { exact: true }),
    ).toBeVisible();
    await expect(editor.getByLabel("正文", { exact: true })).toHaveValue(
      "我的补充",
    );
    await editor.getByRole("button", { name: "暂存并关闭" }).click();
    await expect(editor).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: "继续编辑", exact: true }).click();
    editor = page.getByRole("dialog", { name: /编辑文档/ });
    await expect(editor.getByLabel("正文", { exact: true })).toHaveValue(
      "我的补充",
    );
    await expect(
      editor.getByText("文档已有新版本，你的编辑内容仍在这里", { exact: true }),
    ).toBeVisible();
    await editor.locator("summary").click();
    await expect(editor.getByText("同事的补充", { exact: true })).toBeVisible();
    const violations = await page.evaluate(async () => {
      const result = await (
        window as typeof window & { axe: typeof axe }
      ).axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
        },
      });
      return result.violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map(({ target }) => target.join(" ")),
      }));
    });
    expect(violations).toEqual([]);
    await editor
      .getByLabel("正文", { exact: true })
      .fill("同事的补充\n我的补充");
    await editor
      .getByRole("button", { name: "合并后保存新版本", exact: true })
      .click();
    await page.getByRole("button", { name: "确认保存", exact: true }).click();
    await expect(editor).toHaveCount(0);
    const detail = await page.request.get(
      `/api/v1/content-documents/${doc.id}?${new URLSearchParams(scope)}`,
    );
    expect((await detail.json()).data).toMatchObject({
      currentVersion: 3,
      body: "同事的补充\n我的补充",
      versions: [{ version: 3 }, { version: 2 }, { version: 1 }],
    });
    const versions = await database.db
      .select()
      .from(database.contentDocumentVersions)
      .where(operators.eq(database.contentDocumentVersions.documentId, doc.id));
    expect(versions.map((version) => version.body)).toEqual(
      expect.arrayContaining(["初稿", "同事的补充", "同事的补充\n我的补充"]),
    );
    await page.getByRole("button", { name: /编\s*辑/ }).click();
    await editor.getByLabel("正文", { exact: true }).fill("需要独立保留的编辑");
    const otherUpdate = await page.request.patch(
      `/api/v1/content-documents/${doc.id}`,
      { headers, data: { ...scope, expectedVersion: 3, body: "新的共同版本" } },
    );
    expect(otherUpdate.status()).toBe(200);
    await editor
      .getByRole("button", { name: "保存新版本", exact: true })
      .click();
    const copies: { key: string; body: unknown; status: number }[] = [];
    await page.route("**/api/v1/content-documents", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      copies.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postDataJSON(),
        status: response.status(),
      });
      if (copies.length === 1) return route.abort("failed");
      return route.fulfill({ response });
    });
    await editor
      .getByRole("button", { name: "另存为新文档", exact: true })
      .click();
    await expect(
      editor.getByText("上次保存结果尚未确认", { exact: true }),
    ).toBeVisible();
    await editor.getByRole("button", { name: "暂存并关闭" }).click();
    await expect(editor).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: "继续编辑", exact: true }).click();
    editor = page.getByRole("dialog", { name: /编辑文档/ });
    await expect(
      editor.getByText("上次保存结果尚未确认", { exact: true }),
    ).toBeVisible();
    await editor
      .getByRole("button", { name: "确认上次保存", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    expect(copies).toHaveLength(2);
    expect(copies[0].status).toBe(201);
    expect(copies[1]).toEqual({ ...copies[0], status: 200 });
    const copied = await database.db
      .select()
      .from(database.contentDocuments)
      .where(
        operators.eq(database.contentDocuments.organizationId, organizationId),
      );
    expect(copied).toHaveLength(2);
    expect(copied.find((item) => item.id === doc.id)?.body).toBe(
      "新的共同版本",
    );
    expect(copied.find((item) => item.id !== doc.id)).toMatchObject({
      body: "需要独立保留的编辑",
      currentVersion: 1,
    });
    await page
      .getByRole("dialog", { name: "协作文章", exact: true })
      .getByRole("button", { name: /close|关闭/i })
      .click();
    await expect(
      page.getByRole("dialog", { name: "协作文章", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "切换亮暗色模式", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect
      .poll(() =>
        page
          .locator(".ant-menu-item-group-title")
          .first()
          .evaluate((element) => getComputedStyle(element).color),
      )
      .toBe("rgb(165, 175, 191)");
    const darkViolations = await page.evaluate(async () => {
      const result = await (
        window as typeof window & { axe: typeof axe }
      ).axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
        },
      });
      return result.violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map(({ target }) => target.join(" ")),
      }));
    });
    expect(darkViolations).toEqual([]);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBeTruthy();
    }
    expect(runtimeErrors).toEqual([]);
  });
  test("企业资产流水查全百条历史，操作者与日期筛选刷新恢复，读取失败独立重试", async ({
    page,
  }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (entry) => {
      if (
        entry.type() === "error" &&
        /content security policy|hydration|validateDOMNesting|Warning:/i.test(
          entry.text(),
        )
      )
        runtimeErrors.push(entry.text());
    });
    await makeEnterpriseAdministrator();
    const { db, balanceAccounts, balanceTransactions, users } = database;
    const { eq, and, isNull } = operators;
    const [first, second] = fixture.scopes;
    const historicalUser = randomUUID();
    fixture.extraUserIds = [historicalUser];
    await db.insert(users).values({
      id: historicalUser,
      name: "已离职的流水操作者",
      username: `old_${historicalUser.slice(0, 8)}`,
      email: `${historicalUser}@test.invalid`,
      status: "disabled",
    });
    const [fund] = await db
      .select()
      .from(balanceAccounts)
      .where(
        and(
          eq(balanceAccounts.organizationId, first.organizationId),
          eq(balanceAccounts.asset, "answerbit_points"),
          isNull(balanceAccounts.brandId),
        ),
      );
    const [brandCny] = await db
      .select()
      .from(balanceAccounts)
      .where(
        and(
          eq(balanceAccounts.organizationId, first.organizationId),
          eq(balanceAccounts.asset, "publication_cny"),
          eq(balanceAccounts.brandId, first.brandId),
        ),
      );
    const ledger = (
      reason: string,
      overrides: Partial<typeof balanceTransactions.$inferInsert> = {},
    ) => ({
      organizationId: first.organizationId,
      asset: "answerbit_points" as const,
      operation: "grant" as const,
      amount: 1,
      targetAccountId: fund.id,
      actorUserId: fixture.userId,
      referenceType: "manual_grant",
      referenceId: randomUUID(),
      idempotencyKey: randomUUID(),
      reason,
      createdAt: new Date("2026-02-20T00:00:00Z"),
      ...overrides,
    });
    await db.insert(balanceTransactions).values([
      ...Array.from({ length: 123 }, (_, index) =>
        ledger(`近期积分入账 ${index + 1}`),
      ),
      ledger("一月历史人民币消耗", {
        asset: "publication_cny",
        operation: "consume",
        amount: 125,
        sourceAccountId: brandCny.id,
        targetAccountId: null,
        actorUserId: historicalUser,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
      ledger("一月系统返还", {
        operation: "restore",
        actorUserId: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
      ledger("另一企业独立流水", {
        organizationId: second.organizationId,
        targetAccountId: null,
      }),
    ]);
    await mockBusinessApis(page);
    let fails = false;
    await page.route("**/api/v1/balance-transactions?**", (route) =>
      fails
        ? route.fulfill({
            status: 503,
            json: { error: { message: "仅流水读取暂时失败" } },
          })
        : route.continue(),
    );
    await page.route("**/api/v1/balance-transactions/actors?**", (route) =>
      route.continue(),
    );
    await page.goto(scopedPath("/dashboard/balances"));
    const card = page
      .locator(".ant-card")
      .filter({ has: page.getByText("企业资产流水", { exact: true }) });
    await expect(
      card.getByText("共 125 条资产流水", { exact: true }),
    ).toBeVisible();
    await card.locator(".ant-pagination-item-7").click();
    await expect(
      card.getByText("一月历史人民币消耗", { exact: true }),
    ).toBeVisible();
    await expect(card.getByText("−¥1.25", { exact: true })).toBeVisible();
    await expect(card.getByText(first.brandId, { exact: true })).toBeVisible();
    await expect(
      card.getByText("另一企业独立流水", { exact: true }),
    ).not.toBeVisible();
    const actor = card.getByRole("combobox", {
      name: "按操作用户筛选资产流水",
    });
    await actor.fill("已离职");
    await page
      .locator(".ant-select-dropdown:visible")
      .getByText(new RegExp("已离职的流水操作者"))
      .click();
    await expect(
      card.getByText("共 1 条资产流水", { exact: true }),
    ).toBeVisible();
    const asset = card.getByRole("combobox", { name: "按资产筛选企业流水" });
    await asset.press("ArrowDown");
    await page
      .locator(".ant-select-dropdown:visible")
      .getByText("发布人民币余额", { exact: true })
      .click();
    const operation = card.getByRole("combobox", {
      name: "按操作类型筛选企业流水",
    });
    await operation.press("ArrowDown");
    await page
      .locator(".ant-select-dropdown:visible")
      .getByText("业务消耗", { exact: true })
      .click();
    await card
      .getByLabel("流水日期（北京时间）", { exact: true })
      .fill("2026-01-01");
    await card.getByLabel("流水日期（北京时间）", { exact: true }).press("Tab");
    await card.getByLabel("流水结束日期", { exact: true }).fill("2026-01-01");
    await card.getByLabel("流水结束日期", { exact: true }).press("Enter");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("ledgerBeginDate"))
      .toBe("2026-01-01");
    await page.reload();
    await expect(
      card.getByText("一月历史人民币消耗", { exact: true }),
    ).toBeVisible();
    await expect(
      card.getByRole("combobox", { name: "按操作用户筛选资产流水" }),
    ).toHaveValue("");
    await expect(
      card
        .locator(".ant-select-selection-item")
        .filter({ hasText: "已离职的流水操作者" }),
    ).toBeVisible();
    await expect(
      card.getByLabel("流水日期（北京时间）", { exact: true }),
    ).toHaveValue("2026-01-01");
    fails = true;
    await card.getByRole("button", { name: "刷新资产", exact: true }).click();
    await expect(
      card.getByText("仅流水读取暂时失败", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("资产读取失败", { exact: true }),
    ).not.toBeVisible();
    await expect(page.locator(".ant-statistic-content").first()).toHaveText(
      "100",
    );
    await expect(
      card.getByText("一月历史人民币消耗", { exact: true }),
    ).not.toBeVisible();
    fails = false;
    await card
      .getByRole("button", { name: "重试读取流水", exact: true })
      .click();
    await expect(
      card.getByText("一月历史人民币消耗", { exact: true }),
    ).toBeVisible();
    for (const theme of ["light", "dark"]) {
      if (theme === "dark")
        await page.getByRole("button", { name: "切换亮暗色模式" }).click();
      await expect
        .poll(() => page.locator("html").getAttribute("data-theme"))
        .toBe(theme);
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await card.scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          )
          .toBeTruthy();
        await page.evaluate(async () => {
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.effect?.getComputedTiming().iterations !== Infinity,
              )
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        await page.evaluate(axe.source);
        const result = await page.evaluate(async () =>
          (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          }),
        );
        expect(
          result.violations.map(({ id, nodes }) => ({
            id,
            targets: nodes.map(({ target }) => target),
          })),
        ).toEqual([]);
        await page.screenshot({
          path: test.info().outputPath(`tenant-ledger-${theme}-${width}.png`),
          fullPage: true,
        });
      }
    }
    expect(runtimeErrors).toEqual([]);
    await card
      .getByRole("button", { name: "清除流水筛选", exact: true })
      .click();
    await expect(
      card.getByText("共 125 条资产流水", { exact: true }),
    ).toBeVisible();
    const enterprise = page.getByRole("combobox", {
      name: "企业",
      exact: true,
    });
    await enterprise.fill(second.name);
    await page
      .locator(".ant-select-dropdown:visible")
      .getByText(second.name, { exact: true })
      .click();
    await expect(
      card.getByText("共 1 条资产流水", { exact: true }),
    ).toBeVisible();
    await expect(
      card.getByText("另一企业独立流水", { exact: true }),
    ).toBeVisible();
    await expect(
      card.getByText("一月历史人民币消耗", { exact: true }),
    ).not.toBeVisible();
    const [role] = await db
      .select()
      .from(database.roles)
      .where(eq(database.roles.code, "tenant_admin"));
    const members = await db
      .select()
      .from(database.organizationMembers)
      .where(eq(database.organizationMembers.userId, fixture.userId));
    await db.delete(database.memberRoles).where(
      operators.and(
        operators.inArray(
          database.memberRoles.memberId,
          members.map((member) => member.id),
        ),
        eq(database.memberRoles.roleId, role.id),
      ),
    );
    for (const path of [
      "balance-transactions",
      "balance-transactions/actors",
      "balances",
    ])
      expect(
        (
          await page.request.get(
            `/api/v1/${path}?organizationId=${first.organizationId}`,
          )
        ).status(),
      ).toBe(403);
    const brandStats = await page.request.get(
      `/api/v1/point-usage?${new URLSearchParams({ organizationId: first.organizationId, teamBindingId: first.teamBindingId, brandId: first.brandId, beginDate: "2026-01-01", endDate: "2026-01-31" })}`,
    );
    expect(brandStats.status()).toBe(200);
    expect((await brandStats.json()).data.organizationBalance).toBeNull();
  });
  test("流水迟到响应不能覆盖新企业或筛选，查账不清空待划拨金额", async ({
    page,
  }) => {
    await makeEnterpriseAdministrator();
    await mockBusinessApis(page);
    const [first, second] = fixture.scopes;
    await database.db.insert(database.balanceTransactions).values(
      fixture.scopes.map((scope) => ({
        organizationId: scope.organizationId,
        asset: "answerbit_points" as const,
        operation: "grant" as const,
        amount: 1,
        actorUserId: fixture.userId,
        referenceType: "manual_grant",
        referenceId: randomUUID(),
        idempotencyKey: randomUUID(),
        reason: `迟到流水 ${scope.name}`,
      })),
    );
    let heldOrganization: string | undefined,
      requested = false;
    let release: () => void = () => {};
    let held = Promise.resolve();
    const hold = (organizationId: string) => {
      heldOrganization = organizationId;
      requested = false;
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    await page.route("**/api/v1/balance-transactions?**", async (route) => {
      const url = new URL(route.request().url());
      if (
        url.searchParams.get("organizationId") === heldOrganization &&
        !url.searchParams.has("operation") &&
        !requested
      ) {
        requested = true;
        const response = await route.fetch();
        await held;
        await route.fulfill({ response }).catch(() => {});
      } else await route.continue();
    });
    await page.route("**/api/v1/balance-transactions/actors?**", (route) =>
      route.continue(),
    );
    // The ordinary menu entry has no explicit scope URL; newest enterprise is selected.
    await page.goto("/dashboard/balances");
    const ledger = page
      .locator(".ant-card")
      .filter({ has: page.getByText("企业资产流水", { exact: true }) });
    const allocation = page
      .locator(".ant-card")
      .filter({ has: page.getByText("企业资产划拨", { exact: true }) });
    await expect(
      ledger.getByText(`迟到流水 ${second.name}`, { exact: true }),
    ).toBeVisible();
    await expect(
      allocation.getByRole("button", { name: "确认划拨", exact: true }),
    ).toBeEnabled();
    const amount = allocation.getByLabel("划拨数量", { exact: true });
    await amount.fill("29");
    await ledger
      .getByRole("combobox", { name: "按资产筛选企业流水" })
      .press("ArrowDown");
    await page
      .locator(".ant-select-dropdown:visible")
      .getByText("腾讯能力积分", { exact: true })
      .click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("ledgerAsset"))
      .toBe("answerbit_points");
    await expect(
      allocation.getByRole("button", { name: "确认划拨", exact: true }),
    ).toBeEnabled();
    await expect(amount).toHaveValue("29");
    hold(second.organizationId);
    await ledger.getByRole("button", { name: "刷新资产", exact: true }).click();
    await expect.poll(() => requested).toBeTruthy();
    const enterprise = page.getByRole("combobox", {
      name: "企业",
      exact: true,
    });
    await enterprise.fill(first.name);
    await page
      .locator(".ant-select-dropdown:visible")
      .getByText(first.name, { exact: true })
      .click();
    await expect(
      ledger.getByText(`迟到流水 ${first.name}`, { exact: true }),
    ).toBeVisible();
    release();
    await expect(
      ledger.getByText(`迟到流水 ${second.name}`, { exact: true }),
    ).not.toBeVisible();
    await expect(amount).toHaveValue("");
    await expect(
      allocation.getByRole("button", { name: "确认划拨", exact: true }),
    ).toBeEnabled();
    await amount.fill("37");
    hold(first.organizationId);
    await ledger.getByRole("button", { name: "刷新资产", exact: true }).click();
    await expect.poll(() => requested).toBeTruthy();
    await ledger
      .getByRole("combobox", { name: "按操作类型筛选企业流水" })
      .press("ArrowDown");
    await page
      .locator(".ant-select-dropdown:visible")
      .getByText("业务消耗", { exact: true })
      .click();
    await expect(
      ledger.getByText("暂无符合条件的资产流水", { exact: true }),
    ).toBeVisible();
    release();
    await expect(
      ledger.getByText(`迟到流水 ${first.name}`, { exact: true }),
    ).not.toBeVisible();
    await expect(amount).toHaveValue("37");
    await ledger
      .getByRole("button", { name: "清除流水筛选", exact: true })
      .click();
    await expect(
      ledger.getByText(`迟到流水 ${first.name}`, { exact: true }),
    ).toBeVisible();
    await expect(amount).toHaveValue("37");
  });
  test("通知完整历史与独立读取恢复，跨页批量已读和品牌权限", async ({
    page,
  }) => {
    await makeEnterpriseAdministrator();
    await mockBusinessApis(page);
    const [scope] = fixture.scopes;
    await database.db.insert(database.notifications).values(
      Array.from({ length: 63 }, (_, i) => ({
        organizationId: scope.organizationId,
        teamBindingId: scope.teamBindingId,
        brandId: scope.brandId,
        type: "metric_anomaly" as const,
        severity: "warning" as const,
        title: `历史通知 ${i}`,
        message: "通知历史回归",
        eventKey: randomUUID(),
        occurredAt: new Date("2026-09-02T01:00:00Z"),
      })),
    );
    let failRules = true;
    await page.route("**/api/v1/notification-rules**", async (route) =>
      failRules
        ? route.fulfill({
            status: 503,
            json: { error: { code: "QA_READ", message: "规则暂不可用" } },
          })
        : route.continue(),
    );
    await page.route("**/api/v1/notifications**", (route) => route.continue());
    await page.goto(
      `/dashboard/notifications?organizationId=${scope.organizationId}&brandId=${scope.brandId}&noticeOrganizationId=${scope.organizationId}&noticePage=4`,
    );
    const history = page
      .locator(".ant-card")
      .filter({ has: page.getByText("站内通知", { exact: true }) });
    await expect(history.getByText("共 63 条通知")).toBeVisible();
    await expect(history.locator(".ant-list-item")).toHaveCount(3);
    await expect(page.getByText("规则读取失败", { exact: true })).toBeVisible();
    failRules = false;
    await page
      .getByRole("button", { name: "重试读取规则", exact: true })
      .click();
    await expect(
      page.getByText("规则读取失败", { exact: true }),
    ).not.toBeVisible();
    await history.getByRole("switch", { name: "仅显示未读通知" }).click();
    await expect(history.locator(".ant-list-item")).toHaveCount(20);
    await page.reload();
    await expect(
      history.getByRole("switch", { name: "仅显示未读通知" }),
    ).toBeChecked();
    await history
      .getByRole("button", { name: "当前筛选全部标为已读", exact: true })
      .click();
    await expect(
      history.getByText("已将当前筛选的 63 条通知标为已读"),
    ).toBeVisible();
    await expect(history.getByText("没有符合条件的未读通知")).toBeVisible();
    await history
      .getByRole("button", { name: "清除通知筛选", exact: true })
      .click();
    await expect(history.locator(".ant-list-item")).toHaveCount(20);
    const runtime: string[] = [];
    page.on("pageerror", (error) => runtime.push(error.message));
    for (const theme of ["light", "dark"]) {
      if ((await page.locator("html").getAttribute("data-theme")) !== theme)
        await page.getByRole("button", { name: "切换亮暗色模式" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect
        .poll(() =>
          history
            .locator(".ant-card-head-title")
            .evaluate((element) => getComputedStyle(element).color),
        )
        .toBe(theme === "dark" ? "rgb(244, 245, 247)" : "rgb(33, 33, 33)");
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.effect?.getComputedTiming().iterations !== Infinity,
            )
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.evaluate(axe.source);
        const result = await page.evaluate(async () =>
          (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          }),
        );
        expect(
          result.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => n.target),
          })),
        ).toEqual([]);
        if (width === 390 || width === 1440)
          await page.screenshot({
            path: `/tmp/geo-notifications-${theme}-${width}.png`,
            fullPage: true,
          });
      }
    }
    expect(runtime).toEqual([]);
    // Restore brand-only membership, retaining the explicit brand access.
    const members = await database.db
      .select()
      .from(database.organizationMembers)
      .where(operators.eq(database.organizationMembers.userId, fixture.userId));
    await database.db.delete(database.memberRoles).where(
      operators.inArray(
        database.memberRoles.memberId,
        members.map((member) => member.id),
      ),
    );
    await database.db.insert(database.notifications).values({
      organizationId: scope.organizationId,
      teamBindingId: scope.teamBindingId,
      type: "low_credits",
      title: "企业私有通知",
      message: "QA",
      eventKey: randomUUID(),
    });
    expect(
      (
        await page.request.get(
          `/api/v1/notification-rules?organizationId=${scope.organizationId}`,
        )
      ).status(),
    ).toBe(403);
    const visible = await page.request.get(
      `/api/v1/notifications?organizationId=${scope.organizationId}`,
    );
    expect(visible.status()).toBe(200);
    expect((await visible.json()).data.total).toBe(63);
    await page.reload();
    await expect(
      page.getByText("企业通知阈值", { exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByText("企业私有通知", { exact: true }),
    ).not.toBeVisible();
  });

  test("通知规则失败保留阈值，并发冲突与响应丢失刷新核对", async ({ page }) => {
    await makeEnterpriseAdministrator();
    await mockBusinessApis(page);
    const [scope] = fixture.scopes;
    const origin = process.env.APP_URL!;
    const input = {
      organizationId: scope.organizationId,
      teamBindingId: scope.teamBindingId,
      type: "low_credits",
      threshold: 1000,
      cooldownMinutes: 1440,
      enabled: true,
    };
    const created = await page.request.post("/api/v1/notification-rules", {
      headers: { Origin: origin },
      data: input,
    });
    expect(created.status()).toBe(201);
    const ruleId = (await created.json()).data.id;
    let rejectWrite = true,
      loseWrite = false,
      failReads = false,
      writes = 0;
    await page.route("**/api/v1/notification-rules**", async (route) => {
      if (route.request().method() === "GET")
        return failReads
          ? route.fulfill({
              status: 503,
              json: { error: { code: "QA_READ", message: "核对暂不可用" } },
            })
          : route.continue();
      writes++;
      if (rejectWrite) {
        rejectWrite = false;
        return route.fulfill({
          status: 422,
          json: { error: { code: "QA_REJECT", message: "保存失败，输入保留" } },
        });
      }
      if (loseWrite) {
        loseWrite = false;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        failReads = true;
        return route.fulfill({
          status: 503,
          json: { error: { code: "QA_LOST", message: "响应丢失" } },
        });
      }
      return route.continue();
    });
    await page.route("**/api/v1/notifications**", (route) => route.continue());
    await page.goto(
      `/dashboard/notifications?organizationId=${scope.organizationId}&brandId=${scope.brandId}`,
    );
    await page.getByRole("button", { name: /^阈\s*值$/ }).click();
    const dialog = page.getByRole("dialog", { name: "修改通知阈值" });
    await dialog.getByLabel("通知阈值", { exact: true }).fill("900");
    await dialog.getByRole("button", { name: /保\s*存/ }).click();
    await expect(dialog.getByText("保存失败，输入保留")).toBeVisible();
    await expect(dialog.getByLabel("通知阈值", { exact: true })).toHaveValue(
      "900",
    );
    const concurrent = await page.request.put(
      `/api/v1/notification-rules/${ruleId}`,
      {
        headers: { Origin: origin },
        data: { ...input, threshold: 800, expected: input },
      },
    );
    expect(concurrent.status()).toBe(200);
    await dialog.getByRole("button", { name: /保\s*存/ }).click();
    await expect(
      dialog.getByText("最新阈值为 800，您的输入仍保留"),
    ).toBeVisible();
    await expect(dialog.getByLabel("通知阈值", { exact: true })).toHaveValue(
      "900",
    );
    await dialog
      .getByRole("button", { name: "以最新配置继续编辑", exact: true })
      .click();
    loseWrite = true;
    await dialog.getByRole("button", { name: /保\s*存/ }).click();
    await expect(dialog.getByText(/保存结果暂时无法核对/)).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("已恢复上次尚未核实的规则保存，请先核对结果。"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "新增规则", exact: true }),
    ).toBeDisabled();
    failReads = false;
    await page
      .getByRole("button", { name: "核对上次保存", exact: true })
      .click();
    await expect(
      page.getByText("已核对：通知规则已保存", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "新增规则", exact: true }),
    ).toBeEnabled();
    expect(writes).toBe(3);
    const logs = await database.db
      .select()
      .from(database.operationLogs)
      .where(
        operators.eq(
          database.operationLogs.organizationId,
          scope.organizationId,
        ),
      );
    expect(
      logs.filter((log) => log.operation === "notification-rule.update"),
    ).toHaveLength(2);
  });
  test("报告历史检索、分页与刷新恢复，读取失败独立重试", async ({ page }) => {
    await mockBusinessApis(page);
    await mockAnswerReads(page);
    const [scope, other] = fixture.scopes;
    const filters = {
      beginDate: "2026-08-01",
      endDate: "2026-08-31",
      keyword: "原关键词_50%",
      platforms: [],
      promptIds: [],
      titleIds: [],
      tagIds: [],
      mentionBrand: -1,
    };
    await database.db.insert(database.reportExports).values(
      Array.from({ length: 63 }, (_, i) => ({
        organizationId: scope.organizationId,
        teamBindingId: scope.teamBindingId,
        brandId: scope.brandId,
        requestedBy: fixture.userId,
        reportType: "answers" as const,
        filters: {
          ...filters,
          keyword: i === 0 ? filters.keyword : "其他问题",
        },
        idempotencyKey: randomUUID(),
        status: "failed" as const,
        filename: `历史回答报告 ${i}.csv`,
        errorCode: "REPORT_PERMISSION_REVOKED",
        createdAt: new Date("2026-09-02T01:00:00Z"),
      })),
    );
    const [expired] = await database.db
      .insert(database.reportExports)
      .values({
        organizationId: scope.organizationId,
        teamBindingId: scope.teamBindingId,
        brandId: scope.brandId,
        requestedBy: fixture.userId,
        reportType: "domain_rank",
        filters,
        idempotencyKey: randomUUID(),
        status: "succeeded",
        expiresAt: new Date(0),
        filename: "过期域名报告.csv",
        createdAt: new Date("2026-09-02T01:00:00Z"),
      })
      .returning();
    await database.db.insert(database.reportExports).values({
      organizationId: other.organizationId,
      teamBindingId: other.teamBindingId,
      brandId: other.brandId,
      requestedBy: fixture.userId,
      reportType: "answers",
      filters,
      idempotencyKey: randomUUID(),
      status: "failed",
      filename: "另一企业私有报告.csv",
    });
    let fail = true;
    await page.route("**/api/v1/report-exports?**", (route) =>
      fail
        ? route.fulfill({
            status: 503,
            json: { error: { code: "QA_READ", message: "报告暂不可用" } },
          })
        : route.continue(),
    );
    await page.goto(
      scopedPath("/dashboard/answers") +
        `&reportOrganizationId=${scope.organizationId}&reportBrandId=${scope.brandId}&reportPage=13`,
    );
    const history = page.getByRole("region", { name: "报告记录", exact: true });
    await expect(
      history.getByText("报告记录读取失败", { exact: true }),
    ).toBeVisible();
    await expect(
      history.getByText("报告数量暂不可用", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /保存当前条件/ }),
    ).toBeEnabled();
    fail = false;
    await history
      .getByRole("button", { name: "重试读取报告", exact: true })
      .click();
    await expect(
      history.getByText("共 64 份报告", { exact: true }),
    ).toBeVisible();
    await expect(history.locator(".ant-list-item")).toHaveCount(4);
    await page.reload();
    await expect(history.locator(".ant-pagination-item-active")).toHaveText(
      "13",
    );
    await history
      .getByRole("combobox", { name: "按报告状态筛选" })
      .press("ArrowDown");
    await page
      .locator(".ant-select-dropdown:visible")
      .getByText("文件已过期", { exact: true })
      .click();
    await expect(
      history.getByText("过期域名报告.csv", { exact: true }),
    ).toBeVisible();
    await expect(
      history.getByText("共 1 份报告", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("reportPage"))
      .toBe("1");
    await history
      .getByRole("button", { name: "清除报告筛选", exact: true })
      .click();
    const search = history.getByRole("searchbox", {
      name: "搜索报告名称、编号或原关键词",
    });
    await search.fill("原关键词_50%");
    await search.press("Enter");
    await expect(
      history.getByText("共 2 份报告", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(search).toHaveValue("原关键词_50%");
    await search.fill(expired.id);
    await search.press("Enter");
    await expect(
      history.getByText("共 1 份报告", { exact: true }),
    ).toBeVisible();
    const runtime: string[] = [];
    page.on("pageerror", (error) => runtime.push(error.message));
    for (const theme of ["light", "dark"]) {
      if ((await page.locator("html").getAttribute("data-theme")) !== theme)
        await page.getByRole("button", { name: "切换亮暗色模式" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect
        .poll(() =>
          history
            .getByText("报告记录", { exact: true })
            .evaluate((element) => getComputedStyle(element).color),
        )
        .toBe(theme === "dark" ? "rgb(244, 245, 247)" : "rgb(33, 33, 33)");
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.effect?.getComputedTiming().iterations !== Infinity,
            )
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await history.scrollIntoViewIfNeeded();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.evaluate(axe.source);
        const results = await page.evaluate(async () =>
          (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          }),
        );
        expect(
          results.violations.map(({ id, nodes }) => ({
            id,
            targets: nodes.map(({ target }) => target),
          })),
        ).toEqual([]);
        if (width === 390 || width === 1440)
          await page.screenshot({
            path: `/tmp/geo-report-history-${theme}-${width}.png`,
            fullPage: true,
          });
      }
    }
    expect(runtime).toEqual([]);
    await expect(
      page.getByText("另一企业私有报告.csv", { exact: true }),
    ).not.toBeVisible();
  });

  test("报告迟到响应不覆盖新筛选，新提交保留历史条件并可直接定位", async ({
    page,
  }) => {
    await mockBusinessApis(page);
    await mockAnswerReads(page);
    const [scope] = fixture.scopes;
    const filters = {
      beginDate: "2026-08-01",
      endDate: "2026-08-31",
      keyword: "旧报告",
      platforms: [],
      promptIds: [],
      titleIds: [],
      tagIds: [],
      mentionBrand: -1,
    };
    const [old] = await database.db
      .insert(database.reportExports)
      .values({
        organizationId: scope.organizationId,
        teamBindingId: scope.teamBindingId,
        brandId: scope.brandId,
        requestedBy: fixture.userId,
        reportType: "answers",
        filters,
        idempotencyKey: randomUUID(),
        status: "failed",
        filename: "旧报告.csv",
      })
      .returning();
    let held = false,
      requested = false;
    let release: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/report-exports?**", async (route) => {
      if (
        held &&
        !requested &&
        !new URL(route.request().url()).searchParams.get("q")
      ) {
        requested = true;
        const response = await route.fetch();
        await waiting;
        return route.fulfill({ response }).catch(() => {});
      }
      return route.continue();
    });
    let createdId = "";
    await page.route("**/api/v1/report-exports", async (route) => {
      const body = route.request().postDataJSON();
      const {
        organizationId,
        teamBindingId,
        brandId,
        reportType,
        ...submittedFilters
      } = body;
      const [job] = await database.db
        .insert(database.reportExports)
        .values({
          organizationId,
          teamBindingId,
          brandId,
          reportType,
          filters: submittedFilters,
          requestedBy: fixture.userId,
          idempotencyKey: route.request().headers()["idempotency-key"],
          status: "queued",
        })
        .returning();
      createdId = job.id;
      await route.fulfill({
        status: 201,
        json: envelope({
          ...job,
          fileContent: undefined,
          downloadUrl: null,
          errorMessage: null,
        }),
      });
    });
    await page.goto(scopedPath("/dashboard/answers"));
    const history = page.getByRole("region", { name: "报告记录", exact: true });
    await expect(
      history.getByText("旧报告.csv", { exact: true }),
    ).toBeVisible();
    held = true;
    await history.getByRole("button", { name: /刷新报告/ }).click();
    await expect.poll(() => requested).toBe(true);
    const search = history.getByRole("searchbox", {
      name: "搜索报告名称、编号或原关键词",
    });
    await search.fill("不存在的报告");
    await search.press("Enter");
    await expect(
      history.getByText("暂无符合条件的报告", { exact: true }),
    ).toBeVisible();
    release();
    await expect(
      history.getByText("旧报告.csv", { exact: true }),
    ).not.toBeVisible();
    await page.getByPlaceholder("问题、文章或域名").fill("本次新输入");
    await page.getByRole("button", { name: /回答\s*CSV/ }).click();
    await expect(
      page.getByRole("button", { name: "查看本次报告", exact: true }),
    ).toBeVisible();
    await expect(search).toHaveValue("不存在的报告");
    await expect(
      history.getByText("暂无符合条件的报告", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "查看本次报告", exact: true })
      .click();
    await expect(search).toHaveValue(createdId);
    await expect(history.getByText("等待生成", { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder("问题、文章或域名")).toHaveValue(
      "本次新输入",
    );
    await expect
      .poll(() => new URL(page.url()).searchParams.get("reportQ"))
      .toBe(createdId);
    expect(createdId).not.toBe(old.id);
  });
  for (const variant of [
    {
      name: "新增分类",
      modal: "新增问题分类",
      field: "分类名称",
      submit: "创建分类",
      permission: "新增问题分类",
      resource: "categories",
      method: "POST",
    },
    {
      name: "编辑分类 产品选择",
      modal: "编辑问题分类",
      field: "分类名称",
      submit: "保存分类",
      permission: "编辑问题分类",
      resource: "categories/category-0",
      method: "PATCH",
    },
    {
      name: "新增问题",
      modal: "新增监控问题",
      field: "问题内容",
      submit: "添加问题",
      permission: "新增监控问题",
      resource: "prompts",
      method: "POST",
    },
    {
      name: "编辑问题",
      modal: "编辑监控问题",
      field: "问题内容",
      submit: "保存问题",
      permission: "编辑监控问题",
      resource: "prompts/prompt-0",
      method: "PATCH",
    },
  ]) {
    test(`监测权限刷新保留${variant.modal}输入，在原窗口恢复权限后继续保存`, async ({
      page,
    }) => {
      let writes = 0,
        hold = false,
        requested = false,
        release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      await mockMonitoringApis(page, async (route) => {
        if (route.request().method() === "GET") return false;
        writes++;
        const input = route.request().postDataJSON();
        expect(
          input[variant.field === "分类名称" ? "titleName" : "query"],
        ).toBe("权限恢复后继续提交的原输入");
        expect(route.request().method()).toBe(variant.method);
        await fulfill(route, { id: "restored-resource" });
        return true;
      });
      await page.route("**/api/v1/answerbit/brands?**", async (route) => {
        if (hold) {
          requested = true;
          await pending;
        }
        await route.continue();
      });
      await page.goto(scopedPath("/dashboard/monitoring"));
      const triggerName =
        variant.name === "编辑问题"
          ? `编辑问题 ${fixture.scopes[0].name} 的监测问题`
          : variant.name;
      const trigger = page.getByRole("button", {
        name: triggerName,
        exact: true,
      });
      await expect(trigger).toBeEnabled();
      const setRole = (role: "brand_admin" | "brand_viewer") =>
        database.db
          .update(database.brandAccess)
          .set({ role })
          .where(
            operators.and(
              operators.eq(database.brandAccess.userId, fixture.userId),
              operators.eq(
                database.brandAccess.organizationId,
                fixture.scopes[0].organizationId,
              ),
            ),
          );
      await setRole("brand_viewer");
      hold = true;
      await page
        .getByRole("button", { name: "刷新品牌范围", exact: true })
        .click();
      await expect.poll(() => requested).toBe(true);
      await trigger.click();
      const dialog = page.getByRole("dialog", {
        name: variant.modal,
        exact: true,
      });
      const input = dialog.getByLabel(variant.field, { exact: true });
      await input.fill("权限恢复后继续提交的原输入");
      if (variant.modal === "新增监控问题") {
        await dialog.getByLabel("所属分类", { exact: true }).focus();
        await dialog.getByLabel("所属分类", { exact: true }).press("ArrowDown");
        await page
          .locator(".ant-select-dropdown")
          .getByText("产品选择", { exact: true })
          .click();
      }
      hold = false;
      release();
      await expect(
        dialog.getByText(`当前品牌已没有${variant.permission}权限`, {
          exact: true,
        }),
      ).toBeVisible();
      const submit = dialog.getByRole("button", {
        name: variant.submit,
        exact: true,
      });
      await expect(submit).toBeDisabled();
      await expect(input).toHaveValue("权限恢复后继续提交的原输入");
      await expect(input).toHaveAttribute("readonly", "");
      const payload = {
        organizationId: fixture.scopes[0].organizationId,
        teamBindingId: fixture.scopes[0].teamBindingId,
        brandId: fixture.scopes[0].brandId,
        ...(variant.field === "分类名称"
          ? { titleName: "权限恢复后继续提交的原输入", titleDescription: "" }
          : {
              query: "权限恢复后继续提交的原输入",
              ...(variant.method === "POST" ? { titleId: "category-0" } : {}),
            }),
      };
      const native =
        variant.method === "POST"
          ? await page.request.post(`/api/v1/answerbit/${variant.resource}`, {
              data: payload,
            })
          : await page.request.patch(`/api/v1/answerbit/${variant.resource}`, {
              data: payload,
            });
      expect(native.status()).toBe(403);
      expect(writes).toBe(0);
      await setRole("brand_admin");
      await dialog
        .getByRole("button", { name: "重新检查权限", exact: true })
        .click();
      await expect(submit).toBeEnabled();
      await expect(input).toHaveValue("权限恢复后继续提交的原输入");
      await expect(input).not.toHaveAttribute("readonly", "");
      await submit.click();
      await expect(dialog).toBeHidden();
      expect(writes).toBe(1);
    });
  }

  test("监测分类编辑遇到服务到期保留输入，续期后在原窗口重新检查并保存", async ({
    page,
  }) => {
    const now = Date.now();
    await database.db
      .update(database.organizations)
      .set({ serviceExpiresAt: new Date(now + 90_000) })
      .where(
        operators.eq(
          database.organizations.id,
          fixture.scopes[0].organizationId,
        ),
      );
    await page.clock.install({ time: new Date(now) });
    let writes = 0,
      brandReads = 0;
    await mockMonitoringApis(page, async (route) => {
      if (route.request().method() === "GET") return false;
      writes++;
      expect(route.request().postDataJSON().titleName).toBe("到期前编辑的分类");
      await fulfill(route, {});
      return true;
    });
    await page.route("**/api/v1/answerbit/brands?**", async (route) => {
      brandReads++;
      await route.continue();
    });
    await page.goto(scopedPath("/dashboard/monitoring"));
    await page
      .getByRole("button", { name: "编辑分类 产品选择", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "编辑问题分类",
      exact: true,
    });
    const input = dialog.getByLabel("分类名称", { exact: true });
    await input.fill("到期前编辑的分类");
    await database.db
      .update(database.organizations)
      .set({ serviceExpiresAt: new Date(now - 1000) })
      .where(
        operators.eq(
          database.organizations.id,
          fixture.scopes[0].organizationId,
        ),
      );
    await page.clock.fastForward(100_000);
    await expect(
      dialog.getByText("当前企业服务不可用，暂时无法编辑问题分类", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "保存分类", exact: true }),
    ).toBeDisabled();
    await expect(input).toHaveValue("到期前编辑的分类");
    const response = await page.request.patch(
      "/api/v1/answerbit/categories/category-0",
      {
        data: {
          organizationId: fixture.scopes[0].organizationId,
          teamBindingId: fixture.scopes[0].teamBindingId,
          brandId: fixture.scopes[0].brandId,
          titleName: "到期前编辑的分类",
          titleDescription: "",
        },
      },
    );
    expect(response.status()).toBe(403);
    expect(writes).toBe(0);
    expect(brandReads).toBeGreaterThan(0);
    const readsBefore = brandReads;
    const checked = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/dashboard/monitoring" &&
        response.request().resourceType() === "fetch",
    );
    await dialog
      .getByRole("button", { name: "重新检查权限", exact: true })
      .click();
    await checked;
    await expect(
      dialog.getByRole("button", { name: "保存分类", exact: true }),
    ).toBeDisabled();
    await expect(input).toHaveValue("到期前编辑的分类");
    expect(brandReads).toBe(readsBefore);
    expect(writes).toBe(0);
    await database.db
      .update(database.organizations)
      .set({ serviceExpiresAt: new Date(now + 86_400_000) })
      .where(
        operators.eq(
          database.organizations.id,
          fixture.scopes[0].organizationId,
        ),
      );
    await dialog
      .getByRole("button", { name: "重新检查权限", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "保存分类", exact: true }),
    ).toBeEnabled();
    await expect(input).toHaveValue("到期前编辑的分类");
    await dialog.getByRole("button", { name: "保存分类", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(writes).toBe(1);
  });

  test("监测批量去重和限制提前校验，明确失败保留弹窗，提交时锁定输入和关闭", async ({
    page,
  }) => {
    let writes = 0,
      fail = true,
      release!: () => void;
    let completed = false,
      refreshedAfterWrite = false;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockMonitoringApis(page, async (route, path) => {
      if (
        route.request().method() === "GET" &&
        path === "/api/v1/answerbit/prompts" &&
        completed
      )
        refreshedAfterWrite = true;
      if (
        path !== "/api/v1/answerbit/prompts/batch" ||
        route.request().method() !== "POST"
      )
        return false;
      writes++;
      expect(route.request().postDataJSON().prompts).toEqual([
        "如何选择产品？",
        "价格是多少？",
      ]);
      if (fail)
        await route.fulfill({
          status: 422,
          json: {
            error: {
              code: "ANSWERBIT_BUSINESS_ERROR",
              message: "分类已经更新，请检查后重试",
            },
          },
        });
      else {
        await held;
        completed = true;
        await fulfill(route, { prompt_ids: ["new-1", "new-2"] });
      }
      return true;
    });
    await page.goto(scopedPath("/dashboard/monitoring"));
    await expect(
      page.getByText("流程测试企业 A 的监测问题", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "新增问题", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "新增监控问题" });
    const text = dialog.getByLabel("问题内容", { exact: true });
    await text.fill(
      Array.from({ length: 101 }, (_, i) => `不同的问题 ${i}`).join("\n"),
    );
    await expect(
      dialog.getByText("单次最多添加 100 个不同的问题，请分批添加。", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "添加问题", exact: true }),
    ).toBeDisabled();
    await text.fill("长".repeat(2001));
    await expect(
      dialog.getByText("每个问题最多 2000 字，请缩短超长的问题。", {
        exact: true,
      }),
    ).toBeVisible();
    expect(writes).toBe(0);
    const input = "  如何选择产品？  \n\n如何选择产品？\n价格是多少？ ";
    await text.fill(input);
    await expect(
      dialog.getByText(/将添加 2 个，已合并 1 行重复内容/),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "添加问题", exact: true }).click();
    await expect(
      dialog.getByText("分类已经更新，请检查后重试", { exact: true }),
    ).toBeVisible();
    await expect(text).toHaveValue(input);
    await expect(
      dialog.getByRole("button", { name: "添加问题", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByText("上次操作结果待核对", { exact: true }),
    ).toHaveCount(0);
    fail = false;
    await dialog.getByRole("button", { name: "添加问题", exact: true }).click();
    await expect.poll(() => writes).toBe(2);
    await expect(text).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: /取\s*消/ }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByText("已创建 2 个监控问题", { exact: true }),
    ).toBeVisible();
    await expect.poll(() => refreshedAfterWrite).toBeTruthy();
    expect(writes).toBe(2);
  });

  test("监测响应丢失刷新恢复原操作，只读核对不重复提交，失败可恢复且明暗多尺寸可访问", async ({
    page,
  }) => {
    let writes = 0,
      failRead = false;
    const runtime: string[] = [];
    page.on("pageerror", (error) => runtime.push(error.message));
    await mockMonitoringApis(page, async (route, path) => {
      if (
        path === "/api/v1/answerbit/prompts" &&
        route.request().method() === "POST"
      ) {
        writes++;
        await route.fulfill({
          status: 502,
          json: {
            error: {
              code: "ANSWERBIT_UNAVAILABLE",
              message: "上游响应丢失，请核对目录",
            },
          },
        });
        return true;
      }
      if (failRead && path === "/api/v1/answerbit/categories") {
        await route.fulfill({
          status: 503,
          json: { error: { message: "分类暂时无法读取" } },
        });
        return true;
      }
      return false;
    });
    await page.goto(scopedPath("/dashboard/monitoring"));
    await expect(
      page.getByText("流程测试企业 A 的监测问题", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "新增问题", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "新增监控问题" });
    await dialog.getByLabel("问题内容", { exact: true }).fill("原提交的问题");
    await dialog.getByRole("button", { name: "添加问题", exact: true }).click();
    await expect(
      dialog.getByText("上游响应丢失，请核对目录", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "添加问题", exact: true }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: /取\s*消/ }).click();
    await expect(
      page.getByText("上次操作结果待核对", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText("原提交的问题", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "新增问题", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "已核对，结束本次操作", exact: true }),
    ).toBeDisabled();
    failRead = true;
    await page
      .getByRole("button", { name: "刷新目录核对", exact: true })
      .click();
    await expect(
      page.getByText("分类暂时无法读取", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("流程测试企业 A 的监测问题", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "已核对，结束本次操作", exact: true }),
    ).toBeDisabled();
    failRead = false;
    await page
      .getByRole("button", { name: "刷新目录核对", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "已核对，结束本次操作", exact: true }),
    ).toBeEnabled();
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        localStorage.setItem("ab-theme", value);
      }, theme);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(
        page.getByText("上次操作结果待核对", { exact: true }),
      ).toBeVisible();
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          )
          .toBeTruthy();
        await page.evaluate(axe.source);
        const result = await page.evaluate(async () =>
          (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          }),
        );
        expect(
          result.violations.map(({ id, nodes }) => ({
            id,
            targets: nodes.map(({ target }) => target),
          })),
        ).toEqual([]);
        if (width === 390 || width === 1440) {
          await page.screenshot({
            path: `/tmp/geo-monitoring-${theme}-${width}.png`,
            fullPage: true,
          });
          await page
            .getByText("上次操作结果待核对", { exact: true })
            .scrollIntoViewIfNeeded();
          await page.screenshot({
            path: `/tmp/geo-monitoring-${theme}-${width}-pending.png`,
            fullPage: true,
          });
          await page
            .getByRole("heading", { name: "监控问题库", exact: true })
            .scrollIntoViewIfNeeded();
        }
      }
    }
    await page
      .getByRole("button", { name: "刷新目录核对", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "已核对，结束本次操作", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "已核对，结束本次操作", exact: true })
      .click();
    await page
      .getByRole("button", { name: "结束本次操作", exact: true })
      .click();
    await expect(
      page.getByText("上次操作结果待核对", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "新增问题", exact: true }).click();
    await expect(dialog.getByLabel("问题内容", { exact: true })).toHaveValue(
      "原提交的问题",
    );
    expect(writes).toBe(1);
    expect(runtime).toEqual([]);
  });

  test("监测分类与模型独立重试，新筛选不显示旧问题，迟到写入不能清空新企业表单", async ({
    page,
  }) => {
    let failCategory = true,
      failModels = true,
      failQuery = false,
      writeRequested = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let categoryReads = 0,
      promptReads = 0;
    await mockMonitoringApis(page, async (route, path) => {
      if (
        path.startsWith("/api/v1/answerbit/prompts/") &&
        route.request().method() === "PATCH"
      ) {
        writeRequested = true;
        await held;
        await fulfill(route, { id: "prompt-0" }).catch(() => {});
        return true;
      }
      if (path === "/api/v1/answerbit/categories") {
        categoryReads++;
        if (failCategory) {
          await route.fulfill({
            status: 503,
            json: { error: { message: "分类独立失败" } },
          });
          return true;
        }
      }
      if (path.endsWith("/dashboard/platforms") && failModels) {
        await route.fulfill({
          status: 503,
          json: { error: { message: "模型独立失败" } },
        });
        return true;
      }
      if (path === "/api/v1/answerbit/prompts") {
        promptReads++;
        if (
          failQuery &&
          new URL(route.request().url()).searchParams.get("query")
        ) {
          await route.fulfill({
            status: 503,
            json: { error: { message: "新条件读取失败" } },
          });
          return true;
        }
      }
      return false;
    });
    await page.goto(scopedPath("/dashboard/monitoring"));
    await expect(
      page.getByText("流程测试企业 A 的监测问题", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("分类独立失败", { exact: true })).toBeVisible();
    await expect(page.getByText("模型独立失败", { exact: true })).toBeVisible();
    const initialPrompts = promptReads;
    failCategory = false;
    await page.getByRole("button", { name: "重试分类", exact: true }).click();
    await expect(page.getByText("分类独立失败", { exact: true })).toHaveCount(
      0,
    );
    expect(promptReads).toBe(initialPrompts);
    failModels = false;
    await page.getByRole("button", { name: "重试模型", exact: true }).click();
    await expect(page.getByText("模型独立失败", { exact: true })).toHaveCount(
      0,
    );
    const initialCategories = categoryReads;
    failQuery = true;
    await page.getByLabel("搜索问题", { exact: true }).fill("新条件");
    await page.getByLabel("搜索问题", { exact: true }).press("Enter");
    await expect(
      page.getByText("新条件读取失败", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("流程测试企业 A 的监测问题", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("当前条件的问题尚未加载，请重试", { exact: true }),
    ).toBeVisible();
    expect(categoryReads).toBe(initialCategories);
    failQuery = false;
    await page.getByRole("button", { name: "立即重试", exact: true }).click();
    await expect(
      page.getByText("流程测试企业 A 的监测问题", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "停用问题 流程测试企业 A 的监测问题",
        exact: true,
      })
      .click();
    await expect.poll(() => writeRequested).toBeTruthy();
    await page.locator("#answerbit-scope-organization").focus();
    await page.locator("#answerbit-scope-organization").press("ArrowDown");
    await page.getByTitle("流程测试企业 B", { exact: true }).click();
    await expect(
      page.getByText("流程测试企业 B 的监测问题", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "新增问题", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "新增监控问题" });
    await dialog
      .getByLabel("问题内容", { exact: true })
      .fill("新企业未提交的输入");
    release();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("问题内容", { exact: true })).toHaveValue(
      "新企业未提交的输入",
    );
    await expect(
      dialog.getByRole("button", { name: "添加问题", exact: true }),
    ).toBeEnabled();
    await expect(page.getByText("问题已停用", { exact: true })).toHaveCount(0);
  });
  test("监测切换回来仍等待原写入，不能提前结束核对，迟到成功刷新当前目录", async ({
    page,
  }) => {
    let release!: () => void,
      requested = false,
      written = false;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockMonitoringApis(page, async (route, path, index) => {
      if (route.request().method() === "PATCH") {
        requested = true;
        await held;
        written = true;
        await fulfill(route, { id: "prompt-0" }).catch(() => {});
        return true;
      }
      if (written && path === "/api/v1/answerbit/prompts" && index === 0) {
        await fulfill(route, {
          total_prompts: 1,
          titles: [
            {
              title_id: "category-0",
              title_name: "产品选择",
              title_desc: "",
              prompt_count: 1,
              exposure: 0,
              avg_rank: 0,
              fluctuation: 0,
              prompts: [
                {
                  id: "prompt-0",
                  query_str: "流程测试企业 A 的监测问题",
                  status: 2,
                  title_id: "category-0",
                  tags: [],
                  exposure: 0,
                  avg_rank: 0,
                  fluctuation: 0,
                },
              ],
            },
          ],
        });
        return true;
      }
      return false;
    });
    await page.goto(scopedPath("/dashboard/monitoring"));
    await page
      .getByRole("button", {
        name: "停用问题 流程测试企业 A 的监测问题",
        exact: true,
      })
      .click();
    await expect.poll(() => requested).toBeTruthy();
    const selectOrganization = async (name: string) => {
      await page.locator("#answerbit-scope-organization").focus();
      await page.locator("#answerbit-scope-organization").press("ArrowDown");
      await page.getByTitle(name, { exact: true }).click();
    };
    await selectOrganization("流程测试企业 B");
    await expect(
      page.getByText("流程测试企业 B 的监测问题", { exact: true }),
    ).toBeVisible();
    await selectOrganization("流程测试企业 A");
    await expect(
      page.getByText("原操作仍在提交，请等待结果后再核对。", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "刷新目录核对", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "已核对，结束本次操作", exact: true }),
    ).toBeDisabled();
    release();
    await expect(
      page.getByText("上次操作结果待核对", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "启用问题 流程测试企业 A 的监测问题",
        exact: true,
      }),
    ).toBeVisible();
  });
  test("竞品校验和明确失败保留输入，提交锁生效，保存完成后正常继续", async ({
    page,
  }) => {
    let writes = 0,
      failure = true,
      release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockOverviewApis(page, async (route, path) => {
      if (
        path !== "/api/v1/answerbit/competitors" ||
        route.request().method() !== "POST"
      )
        return false;
      writes++;
      expect(route.request().postDataJSON().competitorName).toBe("测试竞品");
      if (failure)
        await route.fulfill({
          status: 422,
          json: { error: { message: "竞品名称暂不可用，请修改后重试" } },
        });
      else {
        await held;
        await fulfill(route, { competitorId: "new-competitor" });
      }
      return true;
    });
    await page.goto(scopedPath("/dashboard"));
    await page.getByRole("tab", { name: /竞品管理/ }).click();
    await expect(
      page.getByText("流程测试企业 A 的竞品", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "添加竞品", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "添加竞品", exact: true });
    await dialog.getByLabel("竞品名称", { exact: true }).fill(" ".repeat(3));
    await expect(
      dialog.getByRole("button", { name: "添加竞品", exact: true }),
    ).toBeDisabled();
    await dialog.getByLabel("竞品名称", { exact: true }).fill("长".repeat(256));
    await dialog.getByRole("button", { name: "添加竞品", exact: true }).click();
    await expect(
      dialog.getByText("竞品名称须为 1–255 字，别名最多 255 字。", {
        exact: true,
      }),
    ).toBeVisible();
    expect(writes).toBe(0);
    await dialog.getByLabel("竞品名称", { exact: true }).fill("  测试竞品  ");
    await dialog.getByLabel("竞品别名", { exact: true }).fill("暂存别名");
    await dialog.getByRole("button", { name: "添加竞品", exact: true }).click();
    await expect(
      dialog.getByText("竞品名称暂不可用，请修改后重试", { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByLabel("竞品名称", { exact: true })).toHaveValue(
      "  测试竞品  ",
    );
    failure = false;
    await dialog.getByRole("button", { name: "添加竞品", exact: true }).click();
    await expect.poll(() => writes).toBe(2);
    await expect(dialog.getByLabel("竞品名称", { exact: true })).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: /取\s*消/ }),
    ).toBeDisabled();
    release();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("竞品已添加", { exact: true })).toBeVisible();
    expect(writes).toBe(2);
  });

  test("竞品响应丢失刷新恢复，新增人工核对，编辑与删除按真实目录确认，不重复写入", async ({
    page,
  }) => {
    let creates = 0,
      edits = 0,
      deletes = 0,
      changed = false,
      removed = false;
    await mockOverviewApis(page, async (route, path) => {
      if (!path.startsWith("/api/v1/answerbit/competitors")) return false;
      const method = route.request().method();
      if (method === "POST") creates++;
      if (method === "PATCH") {
        edits++;
        changed = true;
      }
      if (method === "DELETE") {
        deletes++;
        removed = true;
      }
      if (method !== "GET") {
        await route.fulfill({
          status: 502,
          json: { error: { message: "腾讯结果暂未返回，请核对目录" } },
        });
        return true;
      }
      if (changed || removed) {
        await fulfill(
          route,
          removed
            ? []
            : [{ id: "competitor-0", name: "更新后的竞品", alias: "新别名" }],
        );
        return true;
      }
      return false;
    });
    await page.goto(scopedPath("/dashboard"));
    await page.getByRole("tab", { name: /竞品管理/ }).click();
    await page.getByRole("button", { name: "添加竞品", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "添加竞品", exact: true });
    await dialog.getByLabel("竞品名称", { exact: true }).fill("原新增的竞品");
    await dialog.getByRole("button", { name: "添加竞品", exact: true }).click();
    await expect(
      dialog.getByText("腾讯结果暂未返回，请核对目录", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: /取\s*消/ }).click();
    await page.reload();
    await page.getByRole("tab", { name: /竞品管理/ }).click();
    await expect(
      page.getByText("竞品名称：原新增的竞品", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "添加竞品", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "核对竞品目录", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "已核对，结束本次操作", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "已核对，结束本次操作", exact: true })
      .click();
    await page
      .getByRole("button", { name: "结束本次操作", exact: true })
      .click();
    await expect(
      page.getByText("上次竞品操作结果待核对", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "添加竞品", exact: true }).click();
    await expect(dialog.getByLabel("竞品名称", { exact: true })).toHaveValue(
      "原新增的竞品",
    );
    await dialog.getByRole("button", { name: /取\s*消/ }).click();
    await page
      .getByRole("button", { name: "编辑流程测试企业 A 的竞品", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "编辑竞品", exact: true });
    await dialog.getByLabel("竞品名称", { exact: true }).fill("更新后的竞品");
    await dialog.getByLabel("竞品别名", { exact: true }).fill("新别名");
    await dialog.getByRole("button", { name: "保存竞品", exact: true }).click();
    await expect(
      dialog.getByText("腾讯结果暂未返回，请核对目录", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: /取\s*消/ }).click();
    await page.reload();
    await page.getByRole("tab", { name: /竞品管理/ }).click();
    await page
      .getByRole("button", { name: "核对竞品目录", exact: true })
      .click();
    await expect(
      page.getByText("目录已确认竞品名称与别名已更新", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("上次竞品操作结果待核对", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "删除更新后的竞品", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "删除这个竞品？", exact: true });
    await dialog.getByRole("button", { name: "删除竞品", exact: true }).click();
    await expect(
      dialog.getByText("腾讯结果暂未返回，请核对目录", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: /取\s*消/ }).click();
    await page
      .getByRole("button", { name: "核对竞品目录", exact: true })
      .click();
    await expect(
      page.getByText("目录已确认该竞品不存在", { exact: true }),
    ).toBeVisible();
    expect({ creates, edits, deletes }).toEqual({
      creates: 1,
      edits: 1,
      deletes: 1,
    });
  });

  test("竞品目录模型与指标独立重试，超过百个竞品分批查询全部，明暗多尺寸可访问", async ({
    page,
  }) => {
    let failModels = true,
      failCatalog = true,
      failTrends = true;
    const compared = new Set<string>(),
      runtime: string[] = [];
    page.on("pageerror", (error) => runtime.push(error.message));
    await mockOverviewApis(page, async (route, path) => {
      if (path.endsWith("/dashboard/platforms") && failModels) {
        await route.fulfill({
          status: 503,
          json: { error: { message: "模型独立失败" } },
        });
        return true;
      }
      if (path === "/api/v1/answerbit/competitors") {
        if (failCatalog)
          await route.fulfill({
            status: 503,
            json: { error: { message: "竞品独立失败" } },
          });
        else
          await fulfill(
            route,
            Array.from({ length: 123 }, (_, i) => ({
              id: `comp-${i}`,
              name: `对比品牌 ${i}`,
              alias: i === 122 ? "目标别名" : "",
            })),
          );
        return true;
      }
      if (path.endsWith("/exposure-trends") && failTrends) {
        await route.fulfill({
          status: 503,
          json: { error: { message: "曝光趋势独立失败" } },
        });
        return true;
      }
      if (path.endsWith("/exposure-rank")) {
        const ids =
          new URL(route.request().url()).searchParams
            .get("competitorIds")
            ?.split(",") ?? [];
        expect(ids.length).toBeLessThanOrEqual(100);
        ids.forEach((id) => compared.add(id));
        await fulfill(
          route,
          ids.map((id) => ({
            competitor_id: id,
            competitor_name: `排名品牌 ${id}`,
            exposure: 1,
            fluctuation: 0,
            avg_rank: { value: 2, fluctuation: 0 },
          })),
        );
        return true;
      }
      return false;
    });
    await page.goto(scopedPath("/dashboard"));
    await expect(page.getByText("模型独立失败", { exact: true })).toBeVisible();
    await expect(page.getByText(/曝光趋势：曝光趋势独立失败/)).toBeVisible();
    await expect(page.locator(".overview-metric-grid")).toContainText("22.5");
    await page.getByRole("tab", { name: /竞品管理/ }).click();
    await expect(page.getByText("竞品独立失败", { exact: true })).toBeVisible();
    await expect(
      page.getByText("竞品尚未加载，请重试", { exact: true }),
    ).toBeVisible();
    failCatalog = false;
    failModels = false;
    failTrends = false;
    await page
      .getByRole("button", { name: "重试竞品目录", exact: true })
      .click();
    await page
      .getByRole("button", { name: "重试模型目录", exact: true })
      .click();
    await expect.poll(() => compared.size).toBe(123);
    expect(compared).toEqual(
      new Set(Array.from({ length: 123 }, (_, i) => `comp-${i}`)),
    );
    await page.getByLabel("搜索竞品", { exact: true }).fill("目标别名");
    await expect(page.getByText("对比品牌 122", { exact: true })).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (value) => localStorage.setItem("ab-theme", value),
        theme,
      );
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByRole("tab", { name: /竞品管理/ }).click();
      await expect(
        page.getByRole("button", { name: "添加竞品", exact: true }),
      ).toBeEnabled();
      await expect(page.getByText("对比品牌 0", { exact: true })).toBeVisible();
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          )
          .toBeTruthy();
        await page.evaluate(async () => {
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.effect?.getComputedTiming().iterations !== Infinity,
              )
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        await page.evaluate(axe.source);
        const results = await page.evaluate(async () =>
          (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          }),
        );
        expect(
          results.violations.map(({ id, nodes }) => ({
            id,
            targets: nodes.map(({ target }) => target),
          })),
        ).toEqual([]);
        if (width === 390 || width === 1440) {
          await page
            .getByText("竞品目录", { exact: true })
            .scrollIntoViewIfNeeded();
          await page.screenshot({
            path: `/tmp/geo-competitor-${theme}-${width}.png`,
            fullPage: true,
          });
        }
      }
    }
    expect(runtime).toEqual([]);
  });

  test("竞品删除响应迟到不能关闭新企业编辑，查看者没有写入口，增长行动携带当前范围", async ({
    page,
  }) => {
    let release!: () => void,
      requested = false;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockOverviewApis(page, async (route) => {
      if (route.request().method() !== "DELETE") return false;
      requested = true;
      await held;
      await fulfill(route, {}).catch(() => {});
      return true;
    });
    await page.goto(scopedPath("/dashboard/metering"));
    await page.getByRole("menuitem", { name: /数据总览/ }).click();
    await page.getByRole("tab", { name: /竞品管理/ }).click();
    await page
      .getByRole("button", { name: "删除流程测试企业 A 的竞品", exact: true })
      .click();
    const confirmation = page.getByRole("dialog", {
      name: "删除这个竞品？",
      exact: true,
    });
    await confirmation
      .getByRole("button", { name: "删除竞品", exact: true })
      .click();
    await expect.poll(() => requested).toBeTruthy();
    await expect(
      confirmation.getByRole("button", { name: /取\s*消/ }),
    ).toBeDisabled();
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard\/metering/);
    await page.locator("#answerbit-scope-organization").focus();
    await page.locator("#answerbit-scope-organization").press("ArrowDown");
    await page.getByTitle("流程测试企业 B", { exact: true }).click();
    await page.getByRole("menuitem", { name: /数据总览/ }).click();
    await page.getByRole("tab", { name: /竞品管理/ }).click();
    await expect(
      page.getByText("流程测试企业 B 的竞品", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "编辑流程测试企业 B 的竞品", exact: true })
      .click();
    const editor = page.getByRole("dialog", { name: "编辑竞品", exact: true });
    await editor
      .getByLabel("竞品名称", { exact: true })
      .fill("新企业尚未提交的竞品");
    release();
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel("竞品名称", { exact: true })).toHaveValue(
      "新企业尚未提交的竞品",
    );
    await expect(
      editor.getByRole("button", { name: "保存竞品", exact: true }),
    ).toBeEnabled();
    await editor.getByRole("button", { name: /取\s*消/ }).click();
    await page.getByRole("tab", { name: /增长行动/ }).click();
    const href = await page
      .getByRole("link", { name: "查看问题", exact: true })
      .getAttribute("href");
    expect(
      new URL(href!, "http://localhost").searchParams.get("organizationId"),
    ).toBe(fixture.scopes[1].organizationId);
    expect(new URL(href!, "http://localhost").searchParams.get("brandId")).toBe(
      fixture.scopes[1].brandId,
    );
    await database.db
      .update(database.brandAccess)
      .set({ role: "brand_viewer" })
      .where(operators.eq(database.brandAccess.userId, fixture.userId));
    await page.reload();
    await page.getByRole("tab", { name: /竞品管理/ }).click();
    await expect(
      page.getByText("流程测试企业 B 的竞品", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "添加竞品", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "编辑流程测试企业 B 的竞品",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "删除流程测试企业 B 的竞品",
        exact: true,
      }),
    ).toHaveCount(0);
    const { organizationId, teamBindingId, brandId } = fixture.scopes[1];
    const authorizedShape = await page.request.post(
      "/api/v1/answerbit/competitors",
      {
        data: {
          organizationId,
          teamBindingId,
          brandId,
          competitorName: "不可创建",
          competitorAlias: "",
        },
      },
    );
    expect(authorizedShape.status()).toBe(403);
    expect((await authorizedShape.json()).error.code).toBe("PERMISSION_DENIED");
  });
  test("回答证据独立读取和完整分页，失败不显示旧条件，关键词回车立即查询", async ({
    page,
  }) => {
    await mockBusinessApis(page);
    await mockAnswerReads(page);
    const reads = { answers: 0, domains: 0, articles: 0 };
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fail = false,
      heldInitial = true,
      shrink = false,
      failModels = true;
    await page.route("**/api/v1/answerbit/dashboard/platforms**", (route) =>
      failModels
        ? route.fulfill({
            status: 503,
            json: { error: { message: "模型证据独立失败" } },
          })
        : fulfill(route, { deepseek: "DeepSeek" }),
    );
    await page.route("**/api/v1/answerbit/answers?**", async (route) => {
      reads.answers++;
      const url = new URL(route.request().url());
      if (heldInitial) {
        heldInitial = false;
        await held;
      }
      if (fail)
        return route.fulfill({
          status: 503,
          json: { error: { message: "回答证据读取失败" } },
        });
      const current = Number(url.searchParams.get("page"));
      const label = url.searchParams.get("prompt") || "初始条件";
      return fulfill(route, {
        total: 45,
        scores: [
          {
            task_id: `answer-${current}`,
            query_id: "prompt-1",
            query_str: `${label} 第${current}页回答`,
            platform: "deepseek",
            date: "2026-09-23",
            score: 50,
            avg_rank: 1,
            exposure: 1,
            trace_article_cnt: 0,
            title_name: "产品",
            language: "zh",
            zone: "cn",
          },
        ],
      });
    });
    await page.route("**/api/v1/answerbit/citations/**", (route) => {
      const url = new URL(route.request().url());
      const isDomain = url.pathname.endsWith("/domains");
      reads[isDomain ? "domains" : "articles"]++;
      const current = Number(url.searchParams.get("page"));
      const size = Number(url.searchParams.get("pageSize"));
      expect(size).toBe(10);
      const total = shrink ? 4 : 25;
      const reference_count = Array.from(
        { length: Math.max(0, Math.min(size, total - (current - 1) * size)) },
        (_, n) => {
          const i = (current - 1) * size + n;
          return isDomain
            ? { domain: `domain-${i}.example`, count: 30 - i, is_own: false }
            : {
                article: `引用证据文章 ${i}`,
                url: `https://example.com/${i}`,
                domain: "example.com",
                count: 30 - i,
                source: 1,
                article_id: `article-${i}`,
              };
        },
      );
      return fulfill(route, { total, reference_count });
    });
    await page.goto(scopedPath("/dashboard/answers"));
    await expect(
      page.getByText("引用证据文章 9", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("domain-9.example", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("模型目录：模型证据独立失败", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("初始条件 第1页回答", { exact: true }),
    ).toHaveCount(0);
    release();
    await expect(
      page.getByText("初始条件 第1页回答", { exact: true }),
    ).toBeVisible();
    const counts = { ...reads };
    await page
      .getByLabel("引用文章分页", { exact: true })
      .getByTitle("2", { exact: true })
      .click();
    await expect(
      page.getByText("引用证据文章 19", { exact: true }),
    ).toBeVisible();
    expect(reads.answers).toBe(counts.answers);
    expect(reads.domains).toBe(counts.domains);
    await page
      .getByLabel("回答分页", { exact: true })
      .getByTitle("2", { exact: true })
      .click();
    await expect(
      page.getByText("初始条件 第2页回答", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("引用证据文章 19", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("引用域名分页", { exact: true })
      .getByTitle("3", { exact: true })
      .click();
    await expect(
      page.getByText("domain-24.example", { exact: true }),
    ).toBeVisible();
    fail = true;
    await page
      .getByRole("button", { name: "查询回答与引用", exact: true })
      .click();
    await expect(
      page.getByText("回答：回答证据读取失败", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("初始条件 第2页回答", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("关键词", { exact: true }).fill("新的关键词");
    await page.getByLabel("关键词", { exact: true }).press("Enter");
    await expect(
      page.getByText("回答：回答证据读取失败", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("初始条件 第2页回答", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("引用证据文章 9", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("domain-9.example", { exact: true }),
    ).toBeVisible();
    fail = false;
    const beforeRetry = { ...reads };
    await page.getByRole("button", { name: "重试回答", exact: true }).click();
    await expect(
      page.getByText("新的关键词 第1页回答", { exact: true }),
    ).toBeVisible();
    expect(reads.domains).toBe(beforeRetry.domains);
    expect(reads.articles).toBe(beforeRetry.articles);
    failModels = false;
    await page
      .getByRole("button", { name: "重试模型目录", exact: true })
      .click();
    await expect(
      page.getByText("模型目录：模型证据独立失败", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByLabel("引用文章分页", { exact: true })
      .getByTitle("3", { exact: true })
      .click();
    await expect(
      page.getByText("引用证据文章 24", { exact: true }),
    ).toBeVisible();
    shrink = true;
    await page
      .getByRole("button", { name: "查询回答与引用", exact: true })
      .click();
    await expect(
      page.getByText("引用证据文章 3", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("引用证据文章 24", { exact: true }),
    ).toHaveCount(0);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (value) => localStorage.setItem("ab-theme", value),
        theme,
      );
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(
        page.getByText("引用证据文章 3", { exact: true }),
      ).toBeVisible();
      if (theme === "light") {
        fail = true;
        await page
          .getByLabel("关键词", { exact: true })
          .fill("不可读取的新条件");
        await page.getByLabel("关键词", { exact: true }).press("Enter");
        await expect(
          page.getByText("回答尚未加载，请重试", { exact: true }),
        ).toBeVisible();
      }
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(async () => {
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (a) => a.effect?.getComputedTiming().iterations !== Infinity,
              )
              .map((a) => a.finished.catch(() => {})),
          );
        });
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          )
          .toBeTruthy();
        await page.evaluate(axe.source);
        const result = await page.evaluate(() =>
          (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          }),
        );
        expect(
          result.violations.map(({ id, nodes }) => ({
            id,
            targets: nodes.map(({ target }) => target),
          })),
        ).toEqual([]);
        if (width === 390 || width === 1440) {
          await page
            .getByText("引用文章", { exact: true })
            .scrollIntoViewIfNeeded();
          await page.screenshot({
            path: `/tmp/geo-answer-evidence-${theme}-${width}.png`,
            fullPage: true,
          });
        }
      }
      fail = false;
    }
  });

  test("回答详情失败在抽屉重试，关闭迟到读取不重开，明暗多尺寸可访问", async ({
    page,
  }) => {
    const runtime: string[] = [];
    page.on("pageerror", (error) => runtime.push(error.message));
    await mockBusinessApis(page);
    let mode: "failed" | "held" | "ready" = "failed",
      requested = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockAnswerReads(page, async (route) => {
      requested++;
      if (mode === "failed")
        return route.fulfill({
          status: 503,
          json: { error: { message: "详情证据读取失败" } },
        });
      if (mode === "held") await held;
      return fulfill(route, {
        query: "当前回答证据",
        query_id: "q-1",
        llm_output: "可以确认的回答正文",
        links: [
          {
            index: 1,
            url: "https://example.com/evidence",
            title: "公开引用证据",
            source: 1,
            article_id: "a-1",
          },
        ],
        platform: "deepseek",
        date: "2026-09-23",
        score: 50,
        rank: 1,
        exposure_cnt: 2,
        language: "zh",
        zone: "cn",
        title_name: "产品",
      }).catch(() => {});
    });
    await page.goto(scopedPath("/dashboard/answers"));
    await page
      .getByRole("button", {
        name: "查看回答：流程测试企业 A 的回答",
        exact: true,
      })
      .click();
    const drawer = page.getByRole("dialog");
    await expect(
      drawer.getByText("详情证据读取失败", { exact: true }),
    ).toBeVisible();
    mode = "ready";
    await drawer
      .getByRole("button", { name: "重试回答详情", exact: true })
      .click();
    await expect(
      drawer.getByText("可以确认的回答正文", { exact: true }),
    ).toBeVisible();
    await drawer.getByRole("button", { name: /close|关闭/i }).click();
    mode = "held";
    await page
      .getByRole("button", {
        name: "查看回答：流程测试企业 A 的回答",
        exact: true,
      })
      .click();
    await expect.poll(() => requested).toBe(3);
    await expect(
      drawer.getByText("可以确认的回答正文", { exact: true }),
    ).toHaveCount(0);
    await drawer.getByRole("button", { name: /close|关闭/i }).click();
    release();
    await expect(drawer).not.toBeVisible();
    mode = "ready";
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (value) => localStorage.setItem("ab-theme", value),
        theme,
      );
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page
          .getByRole("button", {
            name: "查看回答：流程测试企业 A 的回答",
            exact: true,
          })
          .click();
        await expect(
          drawer.getByText("可以确认的回答正文", { exact: true }),
        ).toBeVisible();
        await page.evaluate(async () => {
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (a) => a.effect?.getComputedTiming().iterations !== Infinity,
              )
              .map((a) => a.finished.catch(() => {})),
          );
        });
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          )
          .toBeTruthy();
        await page.evaluate(axe.source);
        const result = await page.evaluate(() =>
          (window as unknown as { axe: typeof axe }).axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          }),
        );
        expect(
          result.violations.map(({ id, nodes }) => ({
            id,
            targets: nodes.map(({ target }) => target),
          })),
        ).toEqual([]);
        if (width === 390 || width === 1440)
          await page.screenshot({
            path: `/tmp/geo-answer-detail-${theme}-${width}.png`,
            fullPage: true,
          });
        await drawer.getByRole("button", { name: /close|关闭/i }).click();
      }
    }
    expect(runtime).toEqual([]);
  });
  test.describe("回答日期按当地日历", () => {
    test.use({ timezoneId: "Asia/Shanghai" });
    test("回答本地日期在北京时间凌晨仍查询今天和近七天", async ({ page }) => {
      await mockBusinessApis(page);
      await mockAnswerReads(page);
      await page.clock.install({ time: new Date("2026-10-01T16:30:00Z") });
      const ranges: string[][] = [];
      await page.route("**/api/v1/answerbit/answers?**", async (route) => {
        const url = new URL(route.request().url());
        ranges.push([
          url.searchParams.get("beginDate")!,
          url.searchParams.get("endDate")!,
        ]);
        await route.fallback();
      });
      await page.goto(scopedPath("/dashboard/answers"));
      await expect(
        page.getByText("流程测试企业 A 的回答", { exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("日期范围", { exact: true })).toHaveValue(
        "2026-09-26",
      );
      await expect(page.getByLabel("结束日期", { exact: true })).toHaveValue(
        "2026-10-02",
      );
      expect(ranges.length).toBeGreaterThan(0);
      expect(
        ranges.every(
          ([begin, end]) => begin === "2026-09-26" && end === "2026-10-02",
        ),
      ).toBe(true);
    });
  });
  test("总览浏览器往返恢复企业，加载期间隐藏旧品牌，迟到目录不改写当前范围", async ({
    page,
  }) => {
    await mockOverviewApis(page);
    let hold = true,
      requested = false,
      release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const target = fixture.scopes[1];
    await page.route("**/api/v1/answerbit/brands?**", async (route) => {
      const url = new URL(route.request().url());
      if (
        hold &&
        url.searchParams.get("organizationId") === target.organizationId
      ) {
        requested = true;
        await pending;
      }
      await route.continue().catch(() => {});
    });
    const pairs: string[][] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        url.pathname.startsWith("/api/v1/answerbit/") &&
        url.searchParams.has("brandId")
      )
        pairs.push([
          url.searchParams.get("organizationId")!,
          url.searchParams.get("brandId")!,
        ]);
    });
    await page.goto(scopedPath("/dashboard"));
    await expect(
      page.getByRole("combobox", { name: "品牌", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".overview-metric-grid")).toContainText("22.5");
    await page.evaluate(
      (path) => history.pushState(null, "", path),
      scopedPath("/dashboard", 1),
    );
    await expect.poll(() => requested).toBe(true);
    await expect(
      page
        .getByRole("combobox", { name: "企业", exact: true })
        .locator("../.."),
    ).toContainText(target.name);
    await expect(
      page
        .getByRole("combobox", { name: "品牌", exact: true })
        .locator("../.."),
    ).not.toContainText(fixture.scopes[0].name);
    await expect(page.getByRole("button", { name: /重新查询/ })).toBeDisabled();
    await page.goBack();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("organizationId"))
      .toBe(fixture.scopes[0].organizationId);
    await expect(page.locator(".overview-metric-grid")).toContainText("22.5");
    hold = false;
    release();
    await expect(
      page
        .getByRole("combobox", { name: "品牌", exact: true })
        .locator("../.."),
    ).toContainText(fixture.scopes[0].name);
    await page.goForward();
    await expect(page.locator(".overview-metric-grid")).toContainText("55");
    await expect(
      page
        .getByRole("combobox", { name: "品牌", exact: true })
        .locator("../.."),
    ).toContainText(target.name);
    await expect
      .poll(() => new URL(page.url()).searchParams.get("brandId"))
      .toBe(target.brandId);
    expect(
      pairs.every(([organizationId, brandId]) =>
        fixture.scopes.some(
          (scope) =>
            scope.organizationId === organizationId &&
            scope.brandId === brandId,
        ),
      ),
    ).toBe(true);
  });

  for (const operation of ["添加", "编辑", "删除"] as const) {
    test(`总览刷新权限期间${operation}竞品保留原窗口，降级阻止提交，恢复权限后继续`, async ({
      page,
    }) => {
      const target = fixture.scopes[0];
      const original = `${target.name} 的竞品`;
      let rows = [{ id: "competitor-0", name: original, alias: "原别名" }];
      const writes: string[] = [];
      await mockOverviewApis(page, async (route, path) => {
        if (
          path === "/api/v1/answerbit/competitors" &&
          route.request().method() === "GET"
        ) {
          await fulfill(route, rows);
          return true;
        }
        if (
          path.startsWith("/api/v1/answerbit/competitors") &&
          route.request().method() !== "GET"
        ) {
          const method = route.request().method();
          writes.push(method);
          if (method === "DELETE") rows = [];
          else {
            const body = route.request().postDataJSON();
            rows = [
              {
                id: "competitor-0",
                name: body.competitorName,
                alias: body.competitorAlias,
              },
            ];
          }
          await fulfill(route, { id: "competitor-0" });
          return true;
        }
        return false;
      });
      let hold = false,
        requested = false,
        fail = false,
        release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/v1/answerbit/brands?**", async (route) => {
        if (fail)
          return route.fulfill({
            status: 503,
            json: { error: { message: "品牌目录暂时不可用" } },
          });
        if (hold) {
          requested = true;
          await pending;
        }
        await route.continue();
      });
      const setRole = (role: "brand_admin" | "brand_viewer") =>
        database.db
          .update(database.brandAccess)
          .set({ role })
          .where(
            operators.and(
              operators.eq(database.brandAccess.userId, fixture.userId),
              operators.eq(
                database.brandAccess.organizationId,
                target.organizationId,
              ),
            ),
          );
      await page.goto(scopedPath("/dashboard"));
      await page.getByRole("tab", { name: /竞品管理/ }).click();
      const action = page.getByRole("button", {
        name: operation === "添加" ? "添加竞品" : `${operation}${original}`,
        exact: true,
      });
      await expect(action).toBeEnabled();
      const dialog = page.getByRole("dialog", {
        name: operation === "删除" ? "删除这个竞品？" : `${operation}竞品`,
        exact: true,
      });
      const draft = "权限变更前尚未提交的竞品";
      if (operation === "编辑") {
        await action.click();
        await dialog.getByLabel("竞品名称", { exact: true }).fill(draft);
        await dialog.getByRole("button", { name: /取\s*消/ }).click();
        fail = true;
        await page
          .getByRole("button", { name: "刷新品牌范围", exact: true })
          .click();
        await expect(
          page.getByText("品牌目录暂时不可用", { exact: true }),
        ).toBeVisible();
        await action.click();
        await expect(
          dialog.getByLabel("竞品名称", { exact: true }),
        ).toHaveValue(draft);
        await dialog.getByRole("button", { name: /取\s*消/ }).click();
        fail = false;
      }
      await setRole("brand_viewer");
      hold = true;
      await page
        .getByRole("button", { name: "刷新品牌范围", exact: true })
        .click();
      await expect.poll(() => requested).toBe(true);
      await action.click();
      if (operation !== "删除") {
        await dialog.getByLabel("竞品名称", { exact: true }).fill(draft);
        await dialog.getByLabel("竞品别名", { exact: true }).fill("保留的别名");
      }
      hold = false;
      release();
      await expect(
        dialog.getByText(`当前品牌已没有${operation}竞品权限`, { exact: true }),
      ).toBeVisible();
      const submit = dialog.getByRole("button", {
        name: operation === "编辑" ? "保存竞品" : `${operation}竞品`,
        exact: true,
      });
      await expect(submit).toBeDisabled();
      if (operation !== "删除") {
        await expect(
          dialog.getByLabel("竞品名称", { exact: true }),
        ).toHaveValue(draft);
        await expect(
          dialog.getByLabel("竞品名称", { exact: true }),
        ).toHaveAttribute("readonly", "");
        await expect(
          dialog.getByLabel("竞品别名", { exact: true }),
        ).toHaveValue("保留的别名");
      }
      const input = {
        organizationId: target.organizationId,
        teamBindingId: target.teamBindingId,
        brandId: target.brandId,
        competitorName: draft,
        competitorAlias: "保留的别名",
      };
      const native =
        operation === "添加"
          ? await page.request.post("/api/v1/answerbit/competitors", {
              data: input,
            })
          : operation === "编辑"
            ? await page.request.patch(
                "/api/v1/answerbit/competitors/competitor-0",
                { data: input },
              )
            : await page.request.delete(
                `/api/v1/answerbit/competitors/competitor-0?${new URLSearchParams({ organizationId: target.organizationId, teamBindingId: target.teamBindingId, brandId: target.brandId })}`,
              );
      expect(native.status()).toBe(403);
      expect(writes).toEqual([]);
      await dialog.getByRole("button", { name: /取\s*消/ }).click();
      await setRole("brand_admin");
      await page
        .getByRole("button", { name: "刷新品牌范围", exact: true })
        .click();
      await expect(action).toBeEnabled();
      await action.click();
      if (operation !== "删除")
        await expect(
          dialog.getByLabel("竞品名称", { exact: true }),
        ).toHaveValue(draft);
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(dialog).toBeHidden();
      expect(writes).toEqual([
        operation === "添加"
          ? "POST"
          : operation === "编辑"
            ? "PATCH"
            : "DELETE",
      ]);
      if (operation === "删除")
        await expect(page.getByText(original, { exact: true })).toHaveCount(0);
      else await expect(page.getByText(draft, { exact: true })).toBeVisible();
    });
  }

  test("共享范围切换后刷新与侧栏跳转保留企业，禁止浏览器存储仍可恢复", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const read = Storage.prototype.getItem,
        write = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key: string) {
        if (this === window.localStorage && key.startsWith("geo."))
          throw new Error("QA scope storage unavailable");
        return read.call(this, key);
      };
      Storage.prototype.setItem = function (key: string, value: string) {
        if (this === window.localStorage && key.startsWith("geo."))
          throw new Error("QA scope storage unavailable");
        return write.call(this, key, value);
      };
    });
    await mockBusinessApis(page);
    await mockAnswerReads(page);
    const pairs: string[][] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        url.pathname.startsWith("/api/v1/answerbit/") &&
        url.searchParams.has("brandId")
      )
        pairs.push([
          url.searchParams.get("organizationId")!,
          url.searchParams.get("brandId")!,
        ]);
    });
    await page.goto(`${scopedPath("/dashboard/answers")}&viewMarker=keep`);
    await expect(
      page.getByText("流程测试企业 A 的回答", { exact: true }),
    ).toBeVisible();
    await page.locator("#answerbit-scope-organization").focus();
    await page.locator("#answerbit-scope-organization").press("ArrowDown");
    await page.getByTitle("流程测试企业 B", { exact: true }).click();
    await expect(
      page.getByText("流程测试企业 B 的回答", { exact: true }),
    ).toBeVisible();
    const target = fixture.scopes[1];
    await expect
      .poll(() => new URL(page.url()).searchParams.get("organizationId"))
      .toBe(target.organizationId);
    await expect
      .poll(() => new URL(page.url()).searchParams.get("brandId"))
      .toBe(target.brandId);
    expect(new URL(page.url()).searchParams.get("viewMarker")).toBe("keep");
    await page.reload();
    await expect(
      page.getByText("流程测试企业 B 的回答", { exact: true }),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: /AI 内容生成/ }).click();
    await expect(page.getByLabel("补充资料", { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("organizationId")).toBe(
      target.organizationId,
    );
    expect(new URL(page.url()).searchParams.get("brandId")).toBe(
      target.brandId,
    );
    await page.getByRole("menuitem", { name: /回答与引用/ }).click();
    await expect(
      page.getByText("流程测试企业 B 的回答", { exact: true }),
    ).toBeVisible();
    const notification = page.getByRole("link", {
      name: "打开通知中心",
      exact: true,
    });
    const href = new URL(
      (await notification.getAttribute("href"))!,
      page.url(),
    );
    expect(href.searchParams.get("organizationId")).toBe(target.organizationId);
    expect(href.searchParams.get("brandId")).toBe(target.brandId);
    expect(pairs.length).toBeGreaterThan(0);
    expect(
      pairs.every(([organization, brand]) =>
        fixture.scopes.some(
          (item) =>
            item.organizationId === organization && item.brandId === brand,
        ),
      ),
    ).toBe(true);
  });

  test("共享品牌目录刷新与失败重试保留输入，其他参数不重复读取，失去品牌后停止旧范围", async ({
    page,
  }) => {
    await mockBusinessApis(page);
    await mockAnswerReads(page);
    let reads = 0,
      fail = false,
      empty = false,
      forbidden = false;
    await page.route("**/api/v1/answerbit/brands?**", (route) => {
      reads++;
      if (forbidden)
        return route.fulfill({
          status: 403,
          json: { error: { message: "无权访问此企业" } },
        });
      if (fail)
        return route.fulfill({
          status: 503,
          json: { error: { message: "品牌范围暂不可用" } },
        });
      if (empty) return fulfill(route, []);
      return route.continue();
    });
    await page.goto(scopedPath("/dashboard/answers"));
    await expect(
      page.getByText("流程测试企业 A 的回答", { exact: true }),
    ).toBeVisible();
    const keyword = page.getByLabel("关键词", { exact: true });
    await keyword.fill("目录重试仍保留的输入");
    await keyword.press("Enter");
    await expect(
      page.getByText("流程测试企业 A 的回答", { exact: true }),
    ).toBeVisible();
    const initialReads = reads;
    await page.evaluate(() => {
      const url = new URL(location.href);
      url.searchParams.set("viewMarker", "keep");
      url.searchParams.delete("brandId");
      history.pushState(null, "", url);
    });
    await expect
      .poll(() => new URL(page.url()).searchParams.get("brandId"))
      .toBe(fixture.scopes[0].brandId);
    await expect(keyword).toHaveValue("目录重试仍保留的输入");
    expect(reads).toBe(initialReads);
    fail = true;
    await page
      .getByRole("button", { name: "刷新品牌范围", exact: true })
      .click();
    await expect(
      page.getByText("品牌范围暂不可用", { exact: true }),
    ).toBeVisible();
    await expect(keyword).toHaveValue("目录重试仍保留的输入");
    await expect(
      page.getByText("流程测试企业 A 的回答", { exact: true }),
    ).toBeVisible();
    fail = false;
    await page
      .getByRole("button", { name: "重试加载品牌", exact: true })
      .click();
    await expect(
      page.getByText("品牌范围暂不可用", { exact: true }),
    ).toHaveCount(0);
    await expect(keyword).toHaveValue("目录重试仍保留的输入");
    expect(reads).toBe(initialReads + 2);
    empty = true;
    await page
      .getByRole("button", { name: "刷新品牌范围", exact: true })
      .click();
    await expect(
      page.getByText("当前企业没有可访问品牌", { exact: true }),
    ).toBeVisible();
    await expect(keyword).toBeDisabled();
    await expect(
      page.getByText("流程测试企业 A 的回答", { exact: true }),
    ).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has("brandId")).toBe(false);
    empty = false;
    await page
      .getByRole("button", { name: "刷新品牌范围", exact: true })
      .click();
    await expect(
      page.getByText("流程测试企业 A 的回答", { exact: true }),
    ).toBeVisible();
    await expect(keyword).toHaveValue("");
    forbidden = true;
    await page
      .getByRole("button", { name: "刷新品牌范围", exact: true })
      .click();
    await expect(
      page.getByText("无权访问此企业", { exact: true }),
    ).toBeVisible();
    await expect(keyword).toBeDisabled();
    await expect(
      page.getByText("流程测试企业 A 的回答", { exact: true }),
    ).toHaveCount(0);
  });

  test("共享品牌刷新立即反映角色降级，企业切换移除旧问题和发布来源", async ({
    page,
  }) => {
    await mockBusinessApis(page);
    await page.goto(
      `${scopedPath("/dashboard/content")}&stage=generate&promptId=prompt-1&promptText=old-question`,
    );
    const supplement = page.getByLabel("补充资料", { exact: true });
    await expect(supplement).toBeVisible();
    await supplement.fill("原企业尚未提交的素材");
    await page
      .getByRole("button", { name: "刷新品牌范围", exact: true })
      .click();
    await expect(supplement).toHaveValue("原企业尚未提交的素材");
    await page.locator("#answerbit-scope-organization").focus();
    await page.locator("#answerbit-scope-organization").press("ArrowDown");
    await page.getByTitle("流程测试企业 B", { exact: true }).click();
    await expect(supplement).toHaveValue("");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("brandId"))
      .toBe(fixture.scopes[1].brandId);
    expect(new URL(page.url()).searchParams.has("promptId")).toBe(false);
    expect(new URL(page.url()).searchParams.has("promptText")).toBe(false);
    expect(new URL(page.url()).searchParams.get("stage")).toBe("generate");
    const { eq, and } = operators;
    await database.db
      .update(database.brandAccess)
      .set({ role: "brand_viewer" })
      .where(
        and(
          eq(
            database.brandAccess.organizationId,
            fixture.scopes[1].organizationId,
          ),
          eq(database.brandAccess.userId, fixture.userId),
        ),
      );
    await page
      .getByRole("button", { name: "刷新品牌范围", exact: true })
      .click();
    await expect(supplement).not.toBeVisible();
    await expect(page.getByText("内容目录", { exact: true })).toBeVisible();
    const response = await page.request.post("/api/v1/answerbit/competitors", {
      data: {
        organizationId: fixture.scopes[1].organizationId,
        teamBindingId: fixture.scopes[1].teamBindingId,
        brandId: fixture.scopes[1].brandId,
        competitorName: "不可写入",
        competitorAlias: "",
      },
    });
    expect(response.status()).toBe(403);
  });

  test("企业和品牌积分统计视图独立保存，刷新不改变统计范围", async ({
    page,
  }) => {
    const { eq, and } = operators;
    const [member] = await database.db
      .select()
      .from(database.organizationMembers)
      .where(
        and(
          eq(
            database.organizationMembers.organizationId,
            fixture.scopes[0].organizationId,
          ),
          eq(database.organizationMembers.userId, fixture.userId),
        ),
      );
    const [role] = await database.db
      .select()
      .from(database.roles)
      .where(eq(database.roles.code, "tenant_admin"));
    await database.db
      .insert(database.memberRoles)
      .values({ memberId: member.id, roleId: role.id });
    await mockBusinessApis(page);
    await page.goto(
      `/dashboard/metering?organizationId=${fixture.scopes[0].organizationId}`,
    );
    await expect(
      page.getByText("企业品牌可用积分合计", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("usageView"))
      .toBe("organization");
    await page.reload();
    await expect(
      page.getByText("企业品牌可用积分合计", { exact: true }),
    ).toBeVisible();
    await page.getByText("当前品牌", { exact: true }).click();
    await expect(
      page.getByText("当前品牌可用积分", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("usageView"))
      .toBe("brand");
    await page.reload();
    await expect(
      page.getByText("当前品牌可用积分", { exact: true }),
    ).toBeVisible();
    await page.getByText("企业整体", { exact: true }).click();
    await page.reload();
    await expect(
      page.getByText("企业品牌可用积分合计", { exact: true }),
    ).toBeVisible();
  });
});
