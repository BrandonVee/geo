"use client";

import { Alert, App, Button, Modal, Space, Typography } from "antd";
import { useEffect, useRef, useState } from "react";

type Account = {
  id: string;
  name: string;
  username: string | null;
  status: string;
};
type Failure = {
  message: string;
  organizations?: { id: string; name: string }[];
};

export function AdminAccountStatusAction({
  user,
  currentUserId,
  onChanged,
  onManageOrganization,
}: {
  user: Account;
  currentUserId: string;
  onChanged: () => Promise<void>;
  onManageOrganization: (id: string) => void;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [checking, setChecking] = useState(false);
  const submitting = useRef(false);
  const pendingOrganization = useRef<string | null>(null);
  const mounted = useRef(true);
  const [desiredStatus, setDesiredStatus] = useState<"active" | "disabled">(
    "disabled",
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingOrganization.current = null;
    };
  }, []);

  async function readStatus() {
    const response = await fetch(`/api/v1/admin/users/${user.id}`, {
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.error?.message ?? "账号结果核对失败");
    return body.data.user.status as string;
  }
  async function finish() {
    if (!mounted.current) return;
    setOpen(false);
    setChecking(false);
    message.success(desiredStatus === "disabled" ? "账号已停用" : "账号已启用");
    try {
      await onChanged();
    } catch {
      message.error("账号状态已保存，目录刷新失败，请刷新目录查看最新结果");
    }
  }
  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setFailure(null);
    try {
      if (checking) {
        if ((await readStatus()) === desiredStatus) return await finish();
        if (mounted.current) {
          setChecking(false);
          setFailure({ message: "尚未保存这次变更，请再次确认操作。" });
        }
        return;
      }
      const response = await fetch(`/api/v1/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: desiredStatus }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status >= 500)
          throw new Error(body.error?.message ?? "请求失败");
        if (mounted.current)
          setFailure({
            message: body.error?.message ?? "账号操作未完成",
            organizations: body.error?.details?.organizations,
          });
        return;
      }
      await finish();
    } catch (reason) {
      if (!mounted.current) return;
      try {
        if ((await readStatus()) === desiredStatus) return await finish();
        if (mounted.current)
          setFailure({
            message:
              reason instanceof Error
                ? reason.message
                : "账号操作未完成，请重试",
          });
      } catch {
        if (mounted.current) {
          setChecking(true);
          setFailure({
            message: "提交结果尚未核实，请先核对结果，避免重复操作。",
          });
        }
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const okText = checking
    ? "核对操作结果"
    : desiredStatus === "disabled"
      ? "确认停用"
      : "确认启用";
  return (
    <>
      <Button
        aria-label={`${user.status === "active" ? "停用" : "启用"}账号 ${user.name}`}
        danger={user.status === "active"}
        disabled={user.id === currentUserId && user.status === "active"}
        onClick={() => {
          pendingOrganization.current = null;
          setDesiredStatus(user.status === "active" ? "disabled" : "active");
          setFailure(null);
          setChecking(false);
          setOpen(true);
        }}
      >
        {user.status === "active" ? "停用" : "启用"}
      </Button>
      <Modal
        open={open}
        title={desiredStatus === "disabled" ? "停用此账户？" : "启用此账户？"}
        width={640}
        okText={okText}
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{
          danger: desiredStatus === "disabled",
          disabled: busy,
          "aria-label": okText,
        }}
        maskClosable={!busy}
        onCancel={() => {
          if (busy) return;
          pendingOrganization.current = null;
          setOpen(false);
        }}
        afterClose={() => {
          const organizationId = pendingOrganization.current;
          pendingOrganization.current = null;
          if (mounted.current && organizationId)
            onManageOrganization(organizationId);
        }}
        onOk={() => void submit()}
      >
        <Typography.Paragraph strong>
          {user.name}
          {user.username ? `（@${user.username}）` : ""}
        </Typography.Paragraph>
        <Typography.Paragraph>
          {desiredStatus === "disabled"
            ? "该用户在全部企业的现有登录会话将立即失效；原有成员关系和历史数据保留。"
            : "启用账号保留原有效期与权限；已过期的代理商仍需续期后才能登录。"}
        </Typography.Paragraph>
        {failure ? (
          <Alert
            type="error"
            showIcon
            message="账号操作未完成"
            description={
              <Space direction="vertical">
                <Typography.Text>{failure.message}</Typography.Text>
                {failure.organizations?.map((organization) => (
                  <Button
                    key={organization.id}
                    onClick={() => {
                      pendingOrganization.current = organization.id;
                      setOpen(false);
                    }}
                  >
                    管理企业 · {organization.name}
                  </Button>
                ))}
              </Space>
            }
          />
        ) : null}
      </Modal>
    </>
  );
}
