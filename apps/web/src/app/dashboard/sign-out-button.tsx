"use client";
import { LogoutOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  return (
    <Button
      aria-label="退出登录"
      danger={!compact}
      icon={<LogoutOutlined />}
      onClick={async () => {
        await authClient.signOut();
        router.replace("/sign-in");
        router.refresh();
      }}
      title="退出登录"
      type={compact ? "text" : "default"}
    >
      {!compact && "退出登录"}
    </Button>
  );
}
