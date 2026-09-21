"use client";

import {
  CheckCircleFilled,
  LockOutlined,
  RadarChartOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { Card, Flex, Space, Typography, theme } from "antd";
import type { CSSProperties, ReactNode } from "react";
import { ThemeToggle } from "./theme-toggle";
import styles from "./auth-shell.module.css";

const signals = {
  signIn: [
    ["企业级隔离", "企业与品牌范围始终一致"],
    ["持续检测", "Worker 周期任务独立运行"],
    ["完整审计", "敏感操作与调用可追溯"],
  ],
  setup: [
    ["唯一入口", "初始化成功后立即关闭"],
    ["安全凭证", "scrypt 单向哈希保存"],
    ["权限起点", "从超级管理员开始分配"],
  ],
} as const;

export function AuthShell({
  mode,
  eyebrow,
  title,
  description,
  children,
}: {
  mode: keyof typeof signals;
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { token } = theme.useToken();
  const variables = {
    "--auth-primary": token.colorPrimary,
    "--auth-bg": token.colorBgLayout,
    "--auth-panel": token.colorBgContainer,
    "--auth-border": token.colorBorderSecondary,
    "--auth-text": token.colorText,
    "--auth-muted": token.colorTextSecondary,
  } as CSSProperties;

  return (
    <main className={styles.shell} style={variables}>
      <section className={styles.story} aria-label="平台能力概览">
        <a className={styles.brand} href="/">
          <span className={styles.brandMark} aria-hidden="true">
            <RadarChartOutlined />
          </span>
          Answerbit GEO
        </a>

        <div className={styles.storyContent}>
          <span className={styles.eyebrow}>
            {mode === "setup" ? (
              <SafetyCertificateOutlined />
            ) : (
              <LockOutlined />
            )}
            {mode === "setup" ? "可信初始化" : "安全访问"}
          </span>
          <Typography.Text className={styles.storyTitle}>
            {mode === "setup" ? "初始化企业平台" : "企业 GEO 运营工作台"}
          </Typography.Text>
          <Typography.Paragraph className={styles.storyDescription}>
            {mode === "setup"
              ? "创建首个平台管理员，完成后即可配置腾讯接入、企业成员与业务权限。"
              : "统一处理品牌监测、回答证据、内容生产与发布履约，所有操作都在企业权限和品牌范围内完成。"}
          </Typography.Paragraph>

          <div className={styles.signals}>
            {signals[mode].map(([heading, copy]) => (
              <div className={styles.signal} key={heading}>
                <strong>{heading}</strong>
                <span>{copy}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.storyFooter}>
          <span>ANSWERBIT · GEO INTELLIGENCE</span>
          <Space size={6}>
            <CheckCircleFilled />
            服务端安全会话
          </Space>
        </div>
      </section>

      <section className={styles.formPane}>
        <div className={styles.themeAction}>
          <ThemeToggle />
        </div>
        <Card className={styles.formCard} styles={{ body: { padding: 32 } }}>
          <header className={styles.formHeader}>
            <Typography.Text type="secondary">{eyebrow}</Typography.Text>
            <Typography.Title level={1}>{title}</Typography.Title>
            <Typography.Paragraph className={styles.formDescription}>
              {description}
            </Typography.Paragraph>
          </header>
          {children}
          <Flex className={styles.formFooter} justify="center">
            密码与密钥不会在页面回显 · 会话和权限由服务端持续校验
          </Flex>
        </Card>
      </section>
    </main>
  );
}
