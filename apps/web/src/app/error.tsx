"use client";

import { Alert, Button } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useEffect } from "react";

export default function ApplicationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("application.render_failed", {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return (
    <main className="system-state-page">
      <section className="system-state-card">
        <span className="eyebrow">SYSTEM / RECOVERY</span>
        <h1>页面加载出现问题</h1>
        <p>已保留当前登录状态，可以重新加载本页面。</p>
        <Alert
          type="error"
          showIcon
          message="页面组件未完成渲染"
          description={error.digest ? `故障编号：${error.digest}` : undefined}
        />
        <div className="system-state-actions">
          <Button type="primary" icon={<ReloadOutlined />} onClick={reset}>
            重新加载
          </Button>
          <Button href="/dashboard">返回工作台</Button>
        </div>
      </section>
    </main>
  );
}
