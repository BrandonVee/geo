import axe from "axe-core";
import { expect, test, type Page } from "@playwright/test";

const administrator = {
  name: "端到端管理员",
  username: "e2e_admin",
  password: "E2eAdmin1234!",
};

async function expectNoSeriousAccessibilityViolations(
  page: Page,
  context: string,
) {
  const violations = await page.evaluate(async () => {
    const runner = (
      window as typeof window & {
        axe: {
          run: (
            root: Document,
            options: unknown,
          ) => Promise<{
            violations: Array<{
              id: string;
              impact: string | null;
              nodes: Array<{ target: string[] }>;
            }>;
          }>;
        };
      }
    ).axe;
    const result = await runner.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
    });
    return result.violations
      .filter(({ impact }) => impact === "serious" || impact === "critical")
      .map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map(({ target }) => target.join(" ")),
      }));
  });
  expect(violations, `${context} 存在严重无障碍问题`).toEqual([]);
}

test("首次初始化、失败提示、登录和路由守卫形成完整闭环", async ({
  page,
  context,
}) => {
  await page.addInitScript({ content: axe.source });
  const contentSecurityPolicyViolations: string[] = [];
  let documentNonce: string | undefined;
  page.on("console", (message) => {
    if (message.text().toLowerCase().includes("content security policy"))
      contentSecurityPolicyViolations.push(message.text());
  });
  page.on("response", (response) => {
    if (response.request().resourceType() !== "document") return;
    documentNonce = response
      .headers()
      ["content-security-policy"]?.match(/'nonce-([^']+)'/)?.[1];
  });

  const initialResponse = await page.goto("/sign-in");
  const initialPolicy = initialResponse?.headers()["content-security-policy"];
  expect(initialPolicy).toContain("'strict-dynamic'");
  expect(initialPolicy).toMatch(/'nonce-[^']+'/);
  expect(documentNonce).toBeTruthy();
  expect(
    initialPolicy
      ?.split(";")
      .find((directive) => directive.trim().startsWith("script-src ")),
  ).not.toContain("'unsafe-inline'");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "创建管理员" })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page, "系统初始化页");

  await page.getByLabel("管理员名称").fill(administrator.name);
  await page.getByLabel("管理员账号").fill(administrator.username);
  await page.getByLabel("管理员密码").fill(administrator.password);
  await page.getByLabel("确认密码").fill(administrator.password);
  await page.getByRole("button", { name: "完成初始化" }).click();

  await expect(page).toHaveURL(/\/sign-in\?initialized=1$/);
  await expect(page.getByText("系统初始化完成", { exact: true })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page, "登录页");

  await page.getByLabel("登录账号").fill(administrator.username);
  await page.getByLabel("登录密码").fill("WrongPassword123!");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page.getByText("账号或密码错误", { exact: true })).toBeVisible();

  await page.getByLabel("登录密码").fill(administrator.password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page).toHaveURL(/\/admin\?section=integration$/);
  await expect(
    page.getByText("平台统一腾讯接入", { exact: true }),
  ).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page, "平台腾讯接入页");
  const styleElementNonces = await page
    .locator("style")
    .evaluateAll((elements) =>
      elements.map((element) => (element as HTMLStyleElement).nonce),
    );
  expect(styleElementNonces.length).toBeGreaterThan(0);
  expect(
    new Set(styleElementNonces),
    "运行时样式元素必须始终使用当前文档的 CSP nonce",
  ).toEqual(new Set([documentNonce]));

  await context.clearCookies();
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(
    contentSecurityPolicyViolations,
    "浏览器报告了 Content Security Policy 违规",
  ).toEqual([]);
});
