"use client";

import {
  ApartmentOutlined,
  BellOutlined,
  BookOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  MenuUnfoldOutlined,
  RadarChartOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  SyncOutlined,
  TeamOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import {
  Avatar,
  Badge,
  Button,
  Divider,
  Drawer,
  Flex,
  Grid,
  Layout,
  Menu,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ThemeToggle } from "../theme-toggle";
import { SignOutButton } from "./sign-out-button";

const items = [
  {
    key: "overview",
    path: "/dashboard",
    label: "数据总览",
    icon: <DashboardOutlined />,
  },
  {
    key: "monitoring",
    path: "/dashboard/monitoring",
    label: "用户提问",
    icon: <RadarChartOutlined />,
  },
  {
    key: "content",
    path: "/dashboard/content",
    label: "AI 内容生成",
    icon: <BookOutlined />,
  },
  {
    key: "citations",
    path: "/dashboard/answers",
    label: "回答与引用",
    icon: <ApartmentOutlined />,
  },
  {
    key: "metering",
    path: "/dashboard/metering",
    label: "积分用量",
    icon: <DatabaseOutlined />,
  },
  {
    key: "billing",
    path: "/dashboard/billing",
    label: "余额与发布",
    icon: <WalletOutlined />,
  },
  {
    key: "notifications",
    path: "/dashboard/notifications",
    label: "通知中心",
    icon: <BellOutlined />,
  },
  {
    key: "answerbit",
    path: "/dashboard/settings/answerbit",
    label: "AnswerBit 设置",
    icon: <SettingOutlined />,
  },
  {
    key: "members",
    path: "/dashboard/settings/members",
    label: "成员权限",
    icon: <TeamOutlined />,
  },
] as const;

const navigationGroups = [
  { label: "分析", keys: ["overview", "monitoring", "citations"] },
  { label: "生成", keys: ["content"] },
  { label: "发布", keys: ["billing"] },
  {
    label: "工作空间",
    keys: ["metering", "notifications", "answerbit", "members"],
  },
] as const;

export function DashboardShell({
  userName,
  active,
  children,
}: {
  userName: string;
  active: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const screens = Grid.useBreakpoint();
  const [mounted, setMounted] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const mobile = !screens.lg;

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <Flex align="center" justify="center" style={{ minHeight: "100vh" }}>
        <Spin aria-label="正在加载工作台" size="large" />
      </Flex>
    );
  }

  const navigation = (
    <Menu
      className="dashboard-navigation"
      items={navigationGroups.map((group) => ({
        key: group.label,
        label: group.label,
        type: "group" as const,
        children: group.keys.map((key) => {
          const item = items.find((candidate) => candidate.key === key)!;
          return { key: item.key, label: item.label, icon: item.icon };
        }),
      }))}
      mode="inline"
      onClick={({ key }) => {
        const item = items.find((candidate) => candidate.key === key);
        if (!item) return;
        setDrawerOpen(false);
        router.push(item.path);
      }}
      selectedKeys={[active]}
      style={{ borderInlineEnd: 0 }}
    />
  );

  const sidebar = (
    <div className="dashboard-sidebar-panel">
      <div className="dashboard-brand-block">
        <Typography.Text className="dashboard-wordmark" strong>
          Answerbit GEO
        </Typography.Text>
        <Typography.Text className="dashboard-brand-caption" type="secondary">
          企业运营工作台
        </Typography.Text>
        <div className="dashboard-workspace-chip">
          <Avatar className="dashboard-workspace-avatar" size={24}>
            G
          </Avatar>
          <div>
            <Typography.Text ellipsis strong>
              分析 · 生成 · 发布
            </Typography.Text>
            <Typography.Text ellipsis type="secondary">
              统一企业与品牌范围
            </Typography.Text>
          </div>
        </div>
      </div>

      <div className="dashboard-navigation-scroll">{navigation}</div>

      <Divider className="dashboard-sidebar-divider" />
      <div className="dashboard-sidebar-footer">
        <div className="dashboard-user-summary">
          <Avatar className="dashboard-user-avatar" size={32}>
            {userName.slice(0, 1).toUpperCase()}
          </Avatar>
          <div>
            <Typography.Text ellipsis strong>
              {userName}
            </Typography.Text>
            <Typography.Text ellipsis type="secondary">
              当前登录账户
            </Typography.Text>
          </div>
        </div>
        <Space className="dashboard-utility-actions" size={2}>
          <Tooltip title="切换主题">
            <span>
              <ThemeToggle />
            </span>
          </Tooltip>
          <Tooltip title="通知中心">
            <Button
              aria-label="打开通知中心"
              href="/dashboard/notifications"
              icon={
                <Badge dot>
                  <BellOutlined />
                </Badge>
              }
              type="text"
            />
          </Tooltip>
          <Tooltip title="平台管理">
            <Button
              aria-label="进入平台管理"
              href="/admin"
              icon={<SafetyCertificateOutlined />}
              type="text"
            />
          </Tooltip>
          <Tooltip title="退出登录">
            <span>
              <SignOutButton compact />
            </span>
          </Tooltip>
        </Space>
      </div>
    </div>
  );

  return (
    <Layout className="dashboard-shell">
      {!mobile ? (
        <Layout.Sider
          className="dashboard-sidebar"
          theme="light"
          trigger={null}
          width={248}
        >
          {sidebar}
        </Layout.Sider>
      ) : null}

      <Layout className="dashboard-main-layout">
        {mobile ? (
          <Layout.Header className="dashboard-mobile-header">
            <Space size={8}>
              <Button
                aria-label="打开导航"
                icon={<MenuUnfoldOutlined />}
                onClick={() => setDrawerOpen(true)}
                type="text"
              />
              <Typography.Text className="dashboard-wordmark" strong>
                Answerbit
              </Typography.Text>
            </Space>
            <Space size={2}>
              <Button
                aria-label="打开通知中心"
                href="/dashboard/notifications"
                icon={
                  <Badge dot>
                    <BellOutlined />
                  </Badge>
                }
                type="text"
              />
              <Avatar className="dashboard-user-avatar" size={28}>
                {userName.slice(0, 1).toUpperCase()}
              </Avatar>
            </Space>
          </Layout.Header>
        ) : null}

        <Layout.Content className="dashboard-main-content">
          <div className="dashboard-content-frame">{children}</div>
        </Layout.Content>
      </Layout>

      <Drawer
        onClose={() => setDrawerOpen(false)}
        open={drawerOpen}
        placement="left"
        rootClassName="dashboard-mobile-drawer"
        styles={{ body: { padding: 12 } }}
        title={null}
        width={292}
      >
        {sidebar}
      </Drawer>
    </Layout>
  );
}

export function DashboardPageHeader({
  eyebrow,
  title,
  status,
}: {
  eyebrow: string;
  title: ReactNode;
  status?: string;
}) {
  return (
    <Flex
      align="flex-start"
      className="dashboard-page-header"
      gap={16}
      justify="space-between"
      style={{ width: "100%" }}
      wrap
    >
      <div>
        <Typography.Text type="secondary">{eyebrow}</Typography.Text>
        <Typography.Title level={1} style={{ margin: "4px 0 0" }}>
          {title}
        </Typography.Title>
      </div>
      {status ? <Tag icon={<SyncOutlined spin />}>{status}</Tag> : null}
    </Flex>
  );
}
