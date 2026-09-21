import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { identityService } from "@/server/modules/identity/identity.service";
import { AuthShell } from "../auth-shell";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "系统初始化 · AnswerBit GEO" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await identityService.isInitialized()) redirect("/sign-in");

  return (
    <AuthShell
      description="建立唯一的初始管理身份。完成后初始化入口会关闭，后续账号和权限由管理员统一维护。"
      eyebrow="系统首次启用 · 第 1 步，共 1 步"
      mode="setup"
      title="创建管理员"
    >
      <SetupForm />
    </AuthShell>
  );
}
