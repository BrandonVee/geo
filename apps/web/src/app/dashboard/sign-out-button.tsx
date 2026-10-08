"use client";
import { LogoutOutlined } from "@ant-design/icons";
import { App, Button } from "antd";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  async function signOut() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    message.destroy("sign-out");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Sign out was not confirmed");
      router.replace("/sign-in");
      router.refresh();
    } catch {
      void message.error({
        key: "sign-out",
        content: "退出登录未完成，请重试。",
        duration: 0,
      });
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <Button
      aria-label="退出登录"
      danger={!compact}
      disabled={pending}
      icon={<LogoutOutlined />}
      loading={pending}
      onClick={() => void signOut()}
      title="退出登录"
      type={compact ? "text" : "default"}
    >
      {!compact && "退出登录"}
    </Button>
  );
}
