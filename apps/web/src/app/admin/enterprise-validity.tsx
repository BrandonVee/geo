"use client";
import { Button, DatePicker, Modal, Space, Typography } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
export function EnterpriseValidity({
  organization,
  onClose,
  onSaved,
}: {
  organization: {
    id: string;
    name: string;
    serviceExpiresAt: string | null;
    pointsExpiresAt: string | null;
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [service, setService] = useState(
    organization.serviceExpiresAt
      ? dayjs(organization.serviceExpiresAt)
      : dayjs().add(1, "month"),
  );
  const [points, setPoints] = useState(
    organization.pointsExpiresAt
      ? dayjs(organization.pointsExpiresAt)
      : dayjs().add(1, "year"),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setSaving(true);
    try {
      const response = await fetch(
        `/api/v1/admin/organizations/${organization.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            serviceExpiresAt: service.toISOString(),
            pointsExpiresAt: points.toISOString(),
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "保存失败");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={`${organization.name} · 企业有效期`}
      open
      onCancel={onClose}
      onOk={() => void save()}
      confirmLoading={saving}
      okText="保存有效期"
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Typography.Text>
          企业到期后冻结业务。积分到期后停用积分，已有资产和记录保留。
        </Typography.Text>
        <Space wrap>
          <Typography.Text>企业服务到期</Typography.Text>
          <DatePicker
            aria-label="企业服务到期"
            showTime
            allowClear={false}
            value={service}
            onChange={(value) => {
              if (value) setService(value);
            }}
          />
          <Button
            onClick={() =>
              setService(
                (service.isAfter(dayjs()) ? service : dayjs()).add(1, "month"),
              )
            }
          >
            续 1 个月
          </Button>
          <Button
            onClick={() =>
              setService(
                (service.isAfter(dayjs()) ? service : dayjs()).add(12, "month"),
              )
            }
          >
            续 12 个月
          </Button>
        </Space>
        <Space wrap>
          <Typography.Text>积分到期</Typography.Text>
          <DatePicker
            aria-label="积分到期"
            showTime
            allowClear={false}
            value={points}
            onChange={(value) => {
              if (value) setPoints(value);
            }}
          />
          <Button
            onClick={() =>
              setPoints(
                (points.isAfter(dayjs()) ? points : dayjs()).add(1, "year"),
              )
            }
          >
            续 1 年
          </Button>
        </Space>
        <Typography.Text type="secondary">
          企业有效期优先；企业续期不会自动延长积分有效期。
        </Typography.Text>
        {error ? (
          <Typography.Text type="danger">{error}</Typography.Text>
        ) : null}
      </Space>
    </Modal>
  );
}
