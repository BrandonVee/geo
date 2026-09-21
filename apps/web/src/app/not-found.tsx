import { Button } from "antd";

export default function NotFound() {
  return (
    <main className="system-state-page">
      <section className="system-state-card">
        <span className="eyebrow">HTTP / 404</span>
        <h1>页面不存在</h1>
        <p>链接可能已变更，返回工作台继续操作。</p>
        <div className="system-state-actions">
          <Button type="primary" href="/dashboard">
            返回工作台
          </Button>
          <Button href="/">返回首页</Button>
        </div>
      </section>
    </main>
  );
}
