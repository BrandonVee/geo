import { ThemeToggle } from "./theme-toggle";

export default function Home() {
  return (
    <main className="modern-shell">
      <nav className="top-nav">
        <a className="wordmark" href="/">
          ANSWERBIT / GEO
        </a>
        <div className="nav-right">
          <ThemeToggle />
          <a className="nav-cta" href="/sign-in">
            进入系统
          </a>
        </div>
      </nav>
      <section className="hero">
        <span className="hero-pill">✦ AI 时代的品牌坐标</span>
        <h1 className="hero-title">
          让品牌成为
          <br />
          <span className="grad-text">答案的一部分</span>。
        </h1>
        <p className="hero-sub">
          统一管理 AI 平台中的品牌提及、排名、引用和内容机会，让生成式搜索成为确定性的增长渠道。
        </p>
        <div className="hero-actions">
          <a className="btn-gradient hero-cta" href="/sign-in">
            进入系统 <span>→</span>
          </a>
          <span className="hero-badge">OPENAPI POWERED</span>
        </div>
        <div className="hero-stats">
          <article>
            <strong>24 / 7</strong>
            <span>全时段监测</span>
          </article>
          <article>
            <strong>ALL AI</strong>
            <span>主流平台覆盖</span>
          </article>
          <article>
            <strong>LIVE</strong>
            <span>实时洞察</span>
          </article>
        </div>
      </section>
      <footer className="hero-foot">© ANSWERBIT · GEO INTELLIGENCE PLATFORM</footer>
    </main>
  );
}
