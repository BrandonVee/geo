import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { identityService } from "@/server/modules/identity/identity.service";
import { AuthShell } from "../auth-shell";
import { SignInForm } from "./sign-in-form";
export const metadata: Metadata = { title: "登录 · AnswerBit GEO" };
export const dynamic = "force-dynamic";
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ initialized?: string }>;
}) {
  if (!(await identityService.isInitialized())) redirect("/setup");
  const query = await searchParams;
  return (
    <AuthShell
      description="使用平台管理员分配的账号进入企业工作台；系统不开放自主注册。"
      eyebrow="Answerbit GEO · 企业工作台"
      mode="signIn"
      title="欢迎回来"
    >
      <SignInForm initialized={query.initialized === "1"} />
    </AuthShell>
  );
}
