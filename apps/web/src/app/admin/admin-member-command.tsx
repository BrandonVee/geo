"use client";

import { Alert, App, Button, Modal, Space, Typography } from "antd";
import { useEffect, useRef, useState } from "react";

type MemberCommand =
  | { kind: "grant"; organizationId: string; userId: string; role: string }
  | {
      kind: "status";
      organizationId: string;
      memberId: string;
      status: "active" | "disabled";
    }
  | { kind: "remove"; organizationId: string; memberId: string };

class MemberRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok)
    throw new MemberRequestError(
      response.status,
      body?.error?.message ?? "成员操作未完成",
    );
  return body?.data as T;
}

async function saved(command: MemberCommand) {
  const detail = await request<{
    organization: { answerbitBrandId: string | null };
    members: {
      id: string;
      userId: string;
      memberStatus: string;
      role: string | null;
    }[];
  }>(`/api/v1/admin/organizations/${command.organizationId}`);
  if (command.kind === "remove")
    return !detail.members.some((member) => member.id === command.memberId);
  if (command.kind === "status")
    return detail.members.some(
      (member) =>
        member.id === command.memberId &&
        member.memberStatus === command.status,
    );
  const member = detail.members.find(
    (member) => member.userId === command.userId,
  );
  if (!member || member.memberStatus !== "active") return false;
  if (command.role === "tenant_admin") return member.role === "tenant_admin";
  const user = await request<{
    brandAccess: { organizationId: string; brandId: string; role: string }[];
  }>(`/api/v1/admin/users/${command.userId}`);
  return user.brandAccess.some(
    (access) =>
      access.organizationId === command.organizationId &&
      access.brandId === detail.organization.answerbitBrandId &&
      access.role === command.role,
  );
}

// @project-doc docs/domains/identity_and_access.md#member_lifecycle
export function useAdminMemberCommand(
  scope: string | undefined,
  onSaved: (command: MemberCommand) => Promise<void>,
) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const pending = useRef<MemberCommand | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const version = ++generation.current;
    pending.current = null;
    inFlight.current = false;
    setBusy(false);
    setChecking(false);
    setError("");
    setRefreshFailed(false);
    return () => {
      generation.current = version + 1;
    };
  }, [scope]);

  async function run(input?: MemberCommand) {
    if (inFlight.current) return;
    const command = checking ? pending.current : input;
    if (!command) return;
    const version = generation.current;
    const current = () => version === generation.current;
    inFlight.current = true;
    pending.current = command;
    setBusy(true);
    setError("");
    setRefreshFailed(false);
    let needsVerification = false;
    try {
      if (!checking) {
        try {
          const path = `/api/v1/admin/organizations/${command.organizationId}/members`;
          await request(
            command.kind === "grant" ? path : `${path}/${command.memberId}`,
            command.kind === "remove"
              ? { method: "DELETE" }
              : {
                  method: command.kind === "grant" ? "POST" : "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(
                    command.kind === "grant"
                      ? { userId: command.userId, role: command.role }
                      : { status: command.status },
                  ),
                },
          );
        } catch (reason) {
          if (!current()) return;
          if (reason instanceof MemberRequestError && reason.status < 500) {
            pending.current = null;
            setError(reason.message);
            return;
          }
          needsVerification = true;
        }
      }
      if (!current()) return;
      if (checking || needsVerification) {
        try {
          const confirmed = await saved(command);
          if (!current()) return;
          if (!confirmed) {
            setChecking(false);
            pending.current = null;
            setError(
              "核对后未发现这次变更，请检查当前成员关系后重新确认操作。",
            );
            return;
          }
        } catch {
          if (current()) {
            setChecking(true);
            setError("提交结果尚未核实，请先核对结果，避免重复操作。");
          }
          return;
        }
      }
      pending.current = null;
      setChecking(false);
      message.success(
        command.kind === "grant"
          ? "企业权限已保存"
          : command.kind === "remove"
            ? "成员已移出企业"
            : command.status === "active"
              ? "企业成员已启用"
              : "企业成员已停用",
      );
      try {
        await onSaved(command);
      } catch {
        if (current()) {
          const text = "成员变更已保存，目录刷新失败，请刷新查看最新结果。";
          setError(text);
          setRefreshFailed(true);
          message.warning(text);
        }
      }
    } finally {
      if (current()) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  return {
    busy,
    checking,
    error,
    refreshFailed,
    run,
    clearError: () => {
      if (!checking) setError("");
    },
  };
}

export function AdminMemberActions({
  organization,
  member,
  onChanged,
  onlyRemove = false,
}: {
  organization: { id: string; name: string };
  member: { id: string; name: string; username: string | null; status: string };
  onChanged: () => Promise<void>;
  onlyRemove?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"status" | "remove">("status");
  const [status, setStatus] = useState<"active" | "disabled">("disabled");
  const command = useAdminMemberCommand(
    `${organization.id}:${member.id}`,
    async () => {
      setOpen(false);
      await onChanged();
    },
  );
  const title =
    action === "remove"
      ? "移出此企业？"
      : status === "disabled"
        ? "停用企业成员？"
        : "启用企业成员？";
  const okText = command.checking
    ? "核对操作结果"
    : action === "remove"
      ? "确认移出"
      : status === "disabled"
        ? "确认停用"
        : "确认启用";
  function show(next: "status" | "remove") {
    if (!command.checking) {
      command.clearError();
      setAction(next);
      setStatus(member.status === "active" ? "disabled" : "active");
    }
    setOpen(true);
  }
  return (
    <>
      <Space>
        {!onlyRemove ? (
          <Button
            disabled={command.busy}
            danger={member.status === "active"}
            aria-label={`${member.status === "active" ? "停用" : "启用"}企业成员 ${member.name}`}
            onClick={() => show("status")}
          >
            {member.status === "active" ? "停用" : "启用"}
          </Button>
        ) : null}
        <Button
          danger
          disabled={command.busy}
          aria-label={`移出企业成员 ${member.name}${onlyRemove ? ` · ${organization.name}` : ""}`}
          onClick={() => show("remove")}
        >
          {onlyRemove ? "移出企业" : "移除"}
        </Button>
      </Space>
      <Modal
        open={open}
        title={title}
        width={640}
        okText={okText}
        cancelText="取消"
        confirmLoading={command.busy}
        okButtonProps={{
          danger: action === "remove" || status === "disabled",
          "aria-label": okText,
        }}
        maskClosable={!command.busy}
        onCancel={() => !command.busy && setOpen(false)}
        onOk={() =>
          void command.run(
            action === "remove"
              ? {
                  kind: action,
                  organizationId: organization.id,
                  memberId: member.id,
                }
              : {
                  kind: action,
                  organizationId: organization.id,
                  memberId: member.id,
                  status,
                },
          )
        }
      >
        <Typography.Paragraph strong>
          {member.name}
          {member.username ? `（@${member.username}）` : ""} ·{" "}
          {organization.name}
        </Typography.Paragraph>
        <Typography.Paragraph>
          {action === "remove"
            ? "该企业的成员关系、品牌权限和功能授权将被移除，历史数据保留。"
            : status === "disabled"
              ? "该用户将不能访问此企业，其他企业的权限保留。"
              : "恢复该用户在此企业的成员关系，原有角色与品牌权限保留；账号有效期和企业服务期限仍需满足。"}
        </Typography.Paragraph>
        {command.error ? (
          <Alert
            type="error"
            showIcon
            message="成员操作未完成"
            description={command.error}
          />
        ) : null}
      </Modal>
    </>
  );
}
