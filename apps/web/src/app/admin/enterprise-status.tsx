"use client";
import { Alert, Button, Modal, Space, Typography } from "antd";
import { useState } from "react";
import {
  useEnterpriseCommand,
  type EnterpriseSettings,
} from "./enterprise-command";

export function EnterpriseStatus({
  organization,
  onClose,
  onSaved,
  onRenew,
}: {
  organization: EnterpriseSettings;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onRenew: (organization: EnterpriseSettings) => void;
}) {
  const [baseline, setBaseline] = useState(organization);
  const [desiredStatus] = useState<"active" | "suspended">(
    organization.status === "active" ? "suspended" : "active",
  );
  const command = useEnterpriseCommand(organization.id, onSaved);
  const expired = Boolean(
    baseline.serviceExpiresAt &&
      new Date(baseline.serviceExpiresAt) <= new Date(),
  );
  const needsRenew = desiredStatus === "active" && expired;
  const okText = command.checking
    ? "核对操作结果"
    : needsRenew
      ? "续期并恢复"
      : desiredStatus === "suspended"
        ? "确认冻结"
        : "确认恢复";
  return (
    <Modal
      title={desiredStatus === "suspended" ? "冻结此企业？" : "恢复此企业？"}
      open
      width={640}
      okText={okText}
      cancelText="取消"
      confirmLoading={command.busy}
      maskClosable={!command.busy && !command.checking}
      cancelButtonProps={{ disabled: command.busy || command.checking }}
      onCancel={() => {
        if (!command.busy && !command.checking) onClose();
      }}
      okButtonProps={{
        "aria-label": okText,
        danger: desiredStatus === "suspended",
        disabled: command.busy || Boolean(command.latest),
      }}
      onOk={() => {
        if (needsRenew && !command.checking) onRenew(baseline);
        else
          void command.execute({
            status: desiredStatus,
            expected: {
              status: baseline.status as "active" | "suspended",
              serviceExpiresAt: baseline.serviceExpiresAt,
            },
          });
      }}
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Typography.Text strong>{organization.name}</Typography.Text>
        <Typography.Text>
          {desiredStatus === "suspended"
            ? "所有成员将暂停本企业的新业务操作。已有余额、数据和成员权限保留；已提交任务的结果回收、发布履约与失败退款继续完成。成员仍可登录并访问其他获授权的企业。"
            : "恢复后沿用原成员权限与有效期。积分已到期时，还需单独续积分有效期。"}
        </Typography.Text>
        {needsRenew ? (
          <Alert
            type="warning"
            showIcon
            message="企业服务已到期"
            description="单独恢复无法开放业务。可直接续期并恢复企业。"
          />
        ) : null}
        {command.error ? (
          <Alert
            type="error"
            showIcon
            message="企业操作未完成"
            description={command.error}
          />
        ) : null}
        {command.latest ? (
          <Alert
            type="warning"
            showIcon
            message="企业设置已变化"
            description={
              <Space direction="vertical">
                <Typography.Text>
                  最新状态：
                  {command.latest.status === "active"
                    ? "未手动冻结"
                    : "已手动冻结"}
                  ；服务到期：
                  {command.latest.serviceExpiresAt
                    ? new Date(command.latest.serviceExpiresAt).toLocaleString()
                    : "未设置"}
                </Typography.Text>
                <Button
                  onClick={() => {
                    setBaseline(command.latest!);
                    command.acceptLatest();
                  }}
                >
                  核对后继续
                </Button>
              </Space>
            }
          />
        ) : null}
      </Space>
    </Modal>
  );
}
