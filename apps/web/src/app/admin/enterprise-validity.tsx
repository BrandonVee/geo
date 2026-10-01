"use client";
import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Modal,
  Space,
  Typography,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useState } from "react";
import {
  useEnterpriseCommand,
  type EnterpriseSettings,
} from "./enterprise-command";
import type { AdminUpdateOrganizationInput } from "@geo/contracts";

const date = (value: string | null) => (value ? dayjs(value) : null);
const display = (value: string | null) =>
  value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "未设置（沿用原规则）";
export function EnterpriseValidity({
  organization,
  onClose,
  onSaved,
  restoreOnSave = false,
}: {
  organization: EnterpriseSettings;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  restoreOnSave?: boolean;
}) {
  const [baseline, setBaseline] = useState(organization);
  const [service, setService] = useState(date(organization.serviceExpiresAt));
  const [points, setPoints] = useState(date(organization.pointsExpiresAt));
  const [restore, setRestore] = useState(
    restoreOnSave && organization.status === "suspended",
  );
  const command = useEnterpriseCommand(organization.id, onSaved);
  const locked = command.busy || command.checking || Boolean(command.latest);
  const expired = Boolean(service && !service.isAfter(dayjs()));
  const input: AdminUpdateOrganizationInput = {
    expected: { status: baseline.status as "active" | "suspended" },
  };
  if (
    service &&
    service.valueOf() !== date(baseline.serviceExpiresAt)?.valueOf()
  ) {
    input.serviceExpiresAt = service.toISOString();
    input.expected!.serviceExpiresAt = baseline.serviceExpiresAt;
  }
  if (
    points &&
    points.valueOf() !== date(baseline.pointsExpiresAt)?.valueOf()
  ) {
    input.pointsExpiresAt = points.toISOString();
    input.expected!.pointsExpiresAt = baseline.pointsExpiresAt;
  }
  if (restore && baseline.status === "suspended") input.status = "active";
  const changed = Boolean(
    input.status || input.serviceExpiresAt || input.pointsExpiresAt,
  );
  const okText = command.checking
    ? "核对操作结果"
    : restore
      ? "续期并恢复企业"
      : "保存有效期";
  function renew(value: Dayjs | null, amount: number, unit: "month" | "year") {
    const now = dayjs();
    return (value?.isAfter(now) ? value : now).add(amount, unit);
  }
  return (
    <Modal
      title={`${organization.name} · 企业有效期`}
      open
      width={720}
      onCancel={() => !command.busy && !command.checking && onClose()}
      maskClosable={!command.busy && !command.checking}
      cancelButtonProps={{ disabled: command.busy || command.checking }}
      onOk={() => void command.execute(input)}
      confirmLoading={command.busy}
      okText={okText}
      okButtonProps={{
        "aria-label": okText,
        disabled:
          command.busy ||
          Boolean(command.latest) ||
          (!command.checking && (!changed || (restore && expired))),
      }}
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Typography.Text>
          企业到期后，所有成员暂停本企业业务；积分到期后停止积分消费。已有余额、数据和记录保留。
        </Typography.Text>
        {baseline.status === "suspended" ? (
          <Alert
            type="warning"
            showIcon
            message="企业已手动冻结"
            description="只修改有效期会保留冻结状态。勾选下方恢复选项可在本次保存时一并恢复。"
          />
        ) : null}
        <Space wrap>
          <label htmlFor="enterprise-service-expiry">企业服务到期</label>
          <DatePicker
            id="enterprise-service-expiry"
            aria-label="企业服务到期"
            showTime
            allowClear={false}
            placeholder="未设置（沿用原规则）"
            value={service}
            disabled={locked}
            onChange={(value) => {
              if (value) setService(value);
            }}
          />
          <Button
            disabled={locked}
            onClick={() => setService(renew(service, 1, "month"))}
          >
            续 1 个月
          </Button>
          <Button
            disabled={locked}
            onClick={() => setService(renew(service, 12, "month"))}
          >
            续 12 个月
          </Button>
        </Space>
        {expired ? (
          <Typography.Text type="warning">
            企业服务已到期，请续期后恢复业务。
          </Typography.Text>
        ) : null}
        <Space wrap>
          <label htmlFor="enterprise-points-expiry">积分到期</label>
          <DatePicker
            id="enterprise-points-expiry"
            aria-label="积分到期"
            showTime
            allowClear={false}
            placeholder="未设置（沿用原规则）"
            value={points}
            disabled={locked}
            onChange={(value) => {
              if (value) setPoints(value);
            }}
          />
          <Button
            disabled={locked}
            onClick={() => setPoints(renew(points, 1, "year"))}
          >
            续 1 年
          </Button>
        </Space>
        {points && !points.isAfter(dayjs()) ? (
          <Typography.Text type="warning">
            积分已到期，需单独续期才能继续使用积分。
          </Typography.Text>
        ) : null}
        {baseline.status === "suspended" ? (
          <Checkbox
            checked={restore}
            disabled={locked}
            onChange={(event) => setRestore(event.target.checked)}
          >
            保存时一并恢复企业业务
          </Checkbox>
        ) : null}
        <Typography.Text type="secondary">
          企业服务与积分有效期分别维护；本次只保存已修改的设置。
        </Typography.Text>
        {command.error ? (
          <Alert
            type="error"
            showIcon
            message="企业设置未完成"
            description={command.error}
          />
        ) : null}
        {command.latest ? (
          <Alert
            type="warning"
            showIcon
            message="请核对最新设置"
            description={
              <Space direction="vertical">
                <Typography.Text>
                  企业状态：
                  {command.latest.status === "active"
                    ? "未手动冻结"
                    : "已手动冻结"}
                </Typography.Text>
                <Typography.Text>
                  最新服务到期：{display(command.latest.serviceExpiresAt)}
                </Typography.Text>
                <Typography.Text>
                  最新积分到期：{display(command.latest.pointsExpiresAt)}
                </Typography.Text>
                <Typography.Text>
                  原输入已保留。使用最新设置后，可重新选择续期时长。
                </Typography.Text>
                <Button
                  onClick={() => {
                    setBaseline(command.latest!);
                    setService(date(command.latest!.serviceExpiresAt));
                    setPoints(date(command.latest!.pointsExpiresAt));
                    setRestore(
                      (value) =>
                        value && command.latest!.status === "suspended",
                    );
                    command.acceptLatest();
                  }}
                >
                  使用最新设置继续
                </Button>
              </Space>
            }
          />
        ) : null}
      </Space>
    </Modal>
  );
}
