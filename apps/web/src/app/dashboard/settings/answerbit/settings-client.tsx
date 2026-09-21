"use client";

import { ApiOutlined, BankOutlined, CloudOutlined } from "@ant-design/icons";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Row,
  Skeleton,
  Space,
  Statistic,
  Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";

type PlatformConfiguration = {
  configured: boolean;
  status: "missing" | "active" | "invalid" | "disabled";
  credentialCount: number;
  activeCredentialCount: number;
  enterpriseConnected: boolean;
  brand: {
    brandId: string;
    brandName: string;
    syncedAt: string;
  } | null;
  lastCheckedAt: string | null;
  lastSyncedAt: string | null;
  updatedAt: string | null;
};

type ApiEnvelope<T> = {
  data: T;
  error?: { message?: string };
};

async function request<T>(url: string) {
  const response = await fetch(url);
  const body = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!response.ok)
    throw new Error(body.error?.message ?? `请求失败（${response.status}）`);
  return body.data;
}

const statusMeta = (status: PlatformConfiguration["status"]) => {
  if (status === "active")
    return { badge: "success", label: "运行正常" } as const;
  if (status === "disabled")
    return { badge: "default", label: "已停用" } as const;
  if (status === "missing")
    return { badge: "default", label: "平台未配置" } as const;
  return { badge: "error", label: "等待重新验证" } as const;
};

const formatTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "尚未检测";

export function AnswerBitSettings({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const [configuration, setConfiguration] =
    useState<PlatformConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setConfiguration(
        await request<PlatformConfiguration>(
          `/api/v1/answerbit/platform-configuration?organizationId=${organizationId}`,
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "接入状态加载失败");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading)
    return (
      <Card>
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );

  const meta = statusMeta(configuration?.status ?? "missing");
  const brand = configuration?.brand;

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Row gutter={[16, 16]}>
        <Col lg={8} sm={12} xs={24}>
          <Card>
            <Statistic
              prefix={<ApiOutlined />}
              title="平台腾讯服务"
              value={configuration?.configured ? "已接入" : "未接入"}
            />
            <Badge status={meta.badge} text={meta.label} />
          </Card>
        </Col>
        <Col lg={8} sm={12} xs={24}>
          <Card>
            <Statistic
              prefix={<BankOutlined />}
              title="企业接入"
              value={configuration?.enterpriseConnected ? "已连接" : "待连接"}
            />
            <Typography.Text type="secondary">
              {organizationName}
            </Typography.Text>
          </Card>
        </Col>
        <Col lg={8} sm={24} xs={24}>
          <Card>
            <Statistic
              prefix={<CloudOutlined />}
              title="腾讯品牌"
              value={brand?.brandName ?? "尚未关联"}
            />
            <Typography.Text type="secondary">
              {brand ? `BrandID ${brand.brandId}` : "等待平台关联品牌"}
            </Typography.Text>
          </Card>
        </Col>
      </Row>

      {error ? (
        <Alert
          action={
            <Button onClick={() => void load()} size="small">
              重试
            </Button>
          }
          description={error}
          message="接入状态加载失败"
          showIcon
          type="error"
        />
      ) : null}

      <Card title="企业腾讯接入状态">
        <Descriptions
          bordered
          column={{ md: 2, sm: 1, xs: 1 }}
          items={[
            {
              key: "enterprise",
              label: "平台企业",
              children: organizationName,
            },
            {
              key: "status",
              label: "服务状态",
              children: <Badge status={meta.badge} text={meta.label} />,
            },
            {
              key: "brand",
              label: "腾讯品牌",
              children: brand?.brandName ?? "尚未关联",
            },
            {
              key: "brandId",
              label: "Tencent BrandID",
              children: brand ? (
                <Typography.Text code copyable>
                  {brand.brandId}
                </Typography.Text>
              ) : (
                "—"
              ),
            },
            {
              key: "checked",
              label: "最近检测",
              children: formatTime(configuration?.lastCheckedAt ?? null),
            },
            {
              key: "synced",
              label: "最近更新",
              children: formatTime(brand?.syncedAt ?? null),
            },
          ]}
        />
        {!configuration?.configured ? (
          <Alert
            description="请联系平台管理员完成腾讯接入并关联本企业对应的腾讯品牌。"
            message="腾讯服务尚未开通"
            showIcon
            style={{ marginTop: 16 }}
            type="warning"
          />
        ) : null}
      </Card>
    </Space>
  );
}
