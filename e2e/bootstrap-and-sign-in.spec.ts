import { expect, test } from "@playwright/test";

const administrator = {
  name: "端到端管理员",
  username: "e2e_admin",
  password: "E2eAdmin1234!",
};

test("首次初始化、失败提示、登录和路由守卫形成完整闭环", async ({
  page,
  context,
}) => {
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "创建管理员" })).toBeVisible();

  await page.getByLabel("管理员名称").fill(administrator.name);
  await page.getByLabel("管理员账号").fill(administrator.username);
  await page.getByLabel("管理员密码").fill(administrator.password);
  await page.getByLabel("确认密码").fill(administrator.password);
  await page.getByRole("button", { name: "完成初始化" }).click();

  await expect(page).toHaveURL(/\/sign-in\?initialized=1$/);
  await expect(page.getByText("系统初始化完成", { exact: true })).toBeVisible();

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

  await context.clearCookies();
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/sign-in$/);
});
