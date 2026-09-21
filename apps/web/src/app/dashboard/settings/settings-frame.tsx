"use client";

import {
  ApiOutlined,
  ArrowLeftOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import {
  Breadcrumb,
  Button,
  Card,
  Flex,
  Result,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

type SettingsOrganization = {
  id: string;
  name: string;
  role: string | null;
  status: string;
};

const roleNames: Record<string, string> = {
  tenant_admin: "企业管理员",
  brand_admin: "品牌管理员",
  brand_editor: "品牌编辑",
  brand_viewer: "品牌只读",
};

const sections = [
  {
    key: "answerbit",
    label: "腾讯接入",
    path: "/dashboard/settings/answerbit",
    icon: <ApiOutlined />,
  },
  {
    key: "members",
    label: "成员权限",
    path: "/dashboard/settings/members",
    icon: <TeamOutlined />,
  },
] as const;

export function SettingsFrame({
  active,
  title,
  description,
  organizations,
  organizationId,
  children,
}: {
  active: (typeof sections)[number]["key"];
  title: string;
  description: string;
  organizations: SettingsOrganization[];
  organizationId?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const organization = organizations.find((item) => item.id === organizationId);

  return (
    <Flex
      gap={24}
      style={{ padding: "24px 24px 64px", width: "100%" }}
      vertical
    >
      <Breadcrumb
        items={[
          {
            title: (
              <a href="/dashboard">
                <ArrowLeftOutlined /> 工作台
              </a>
            ),
          },
          {
            title: (
              <Space size={6}>
                <SettingOutlined />
                系统设置
              </Space>
            ),
          },
          { title },
        ]}
      />

      <Card>
        <Flex align="flex-start" gap={24} justify="space-between" wrap>
          <div style={{ maxWidth: 760 }}>
            <Typography.Title level={1} style={{ margin: 0 }}>
              {title}
            </Typography.Title>
            <Typography.Paragraph
              type="secondary"
              style={{ margin: "8px 0 0" }}
            >
              {description}
            </Typography.Paragraph>
          </div>

          <Space direction="vertical" size={6} style={{ minWidth: 280 }}>
            <Flex align="center" justify="space-between">
              <Typography.Text type="secondary">当前企业</Typography.Text>
              {organization ? (
                <Tag
                  color={
                    organization.status === "active" ? "success" : "warning"
                  }
                  icon={<SafetyCertificateOutlined />}
                >
                  {organization.status === "active" ? "企业正常" : "企业受限"}
                </Tag>
              ) : null}
            </Flex>
            <Select
              aria-label="选择配置企业"
              disabled={!organizations.length}
              options={organizations.map((item) => ({
                label: item.name,
                value: item.id,
              }))}
              placeholder="选择企业"
              size="large"
              style={{ width: "100%" }}
              value={organizationId}
              onChange={(nextOrganizationId) => {
                const search = new URLSearchParams({
                  organizationId: nextOrganizationId,
                });
                router.push(`${pathname}?${search.toString()}`);
              }}
            />
            <Typography.Text type="secondary">
              {organization
                ? `${roleNames[organization.role ?? ""] ?? "受限成员"} · 修改实时生效`
                : "尚未加入任何可管理企业"}
            </Typography.Text>
          </Space>
        </Flex>
      </Card>

      <Tabs
        activeKey={active}
        items={sections.map((section) => ({
          key: section.key,
          label: (
            <Space size={8}>
              {section.icon}
              {section.label}
            </Space>
          ),
        }))}
        onChange={(key) => {
          const section = sections.find((item) => item.key === key);
          if (!section) return;
          const query = organizationId
            ? `?organizationId=${encodeURIComponent(organizationId)}`
            : "";
          router.push(`${section.path}${query}`);
        }}
        size="large"
      />

      {children}
    </Flex>
  );
}

export function SettingsPermissionResult({
  description,
}: {
  description: string;
}) {
  return (
    <Card>
      <Result
        extra={
          <Button href="/dashboard" type="primary">
            返回工作台
          </Button>
        }
        status="403"
        subTitle={description}
        title="需要企业管理员权限"
      />
    </Card>
  );
}
