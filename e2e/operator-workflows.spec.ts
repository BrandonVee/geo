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
