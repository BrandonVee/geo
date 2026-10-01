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
    await expect(
      page.getByText("请在订单对应的企业与品牌加入效果追踪", { exact: true }),
    ).toBeVisible();
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
      page.getByRole("button", { name: /回答\s*CSV/ }),
    ).toBeEnabled();
    await page.reload();
    await page.getByPlaceholder("问题、文章或域名").fill("选购问题");
    await page.getByRole("button", { name: /回答\s*CSV/ }).click();
    await expect(page.getByText("等待生成", { exact: true })).toBeVisible();
    expect(keys[1]).toBe(keys[0]);
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
});
