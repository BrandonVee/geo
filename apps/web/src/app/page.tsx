import { ThemeToggle } from "./theme-toggle";

const capabilities = [
  ["监测与洞察", "跨模型查看品牌提及、排名、回答与引用证据。"],
  ["内容生产", "从高价值问题直接进入 AI 内容生成与文档协作。"],
  ["发布与计量", "统一管理发布履约、积分消耗、余额和操作审计。"],
] as const;

export default function Home() {
  return (
    <main className="saas-home">
      <nav className="saas-home-nav" aria-label="主导航">
        <a className="saas-home-brand" href="/">
          <span className="saas-home-brand-mark">A</span>
          <span>
            <strong>Answerbit GEO</strong>
            <small>企业级 GEO 运营平台</small>
          </span>
        </a>
        <div className="saas-home-nav-actions">
          <ThemeToggle />
          <a className="saas-home-login" href="/sign-in">
            登录工作台
          </a>
        </div>
      </nav>

      <section className="saas-home-hero">
        <div className="saas-home-copy">
          <span className="saas-home-kicker">GEO OPERATIONS WORKSPACE</span>
          <h1>把品牌在 AI 中的表现，变成可执行的运营工作。</h1>
          <p>
            在一个企业工作台中完成品牌监测、回答取证、内容生产和发布履约，
            让每项行动都有数据范围、权限和成本记录。
          </p>
          <div className="saas-home-actions">
            <a className="saas-home-primary" href="/sign-in">
              进入企业工作台 <span aria-hidden="true">→</span>
            </a>
            <span>统一企业与品牌范围 · 服务端权限校验</span>
          </div>
          <dl className="saas-home-facts">
            <div>
              <dt>运营闭环</dt>
              <dd>分析 → 生成 → 发布</dd>
            </div>
            <div>
              <dt>数据来源</dt>
              <dd>AnswerBit OpenAPI</dd>
            </div>
            <div>
              <dt>企业治理</dt>
              <dd>权限 · 计量 · 审计</dd>
            </div>
          </dl>
        </div>

        <div className="saas-product-preview" aria-label="产品工作台预览">
          <header>
            <div>
              <span className="saas-preview-mark">A</span>
              <strong>运营总览</strong>
            </div>
            <span className="saas-preview-date">近 30 天</span>
          </header>
          <div className="saas-preview-scope">
            <span>示例企业</span>
            <span>核心品牌</span>
            <span className="saas-preview-live">数据已更新</span>
          </div>
          <div className="saas-preview-metrics">
            <article>
              <span>品牌提及率</span>
              <strong>42.8%</strong>
              <small className="positive">↑ 5.6%</small>
            </article>
            <article>
              <span>平均排名</span>
              <strong>3.2</strong>
              <small className="positive">↑ 0.8</small>
            </article>
            <article>
              <span>内容机会</span>
              <strong>18</strong>
              <small>待处理</small>
            </article>
          </div>
          <div className="saas-preview-workspace">
            <div className="saas-preview-chart">
              <div className="saas-preview-section-title">
                <strong>提及率趋势</strong>
                <span>本品牌 / 竞品</span>
              </div>
              <div className="saas-chart-grid" aria-hidden="true">
                <svg viewBox="0 0 560 180" preserveAspectRatio="none">
                  <polyline
                    className="chart-line chart-line-primary"
                    points="0,142 70,126 140,132 210,88 280,98 350,62 420,70 490,34 560,42"
                  />
                  <polyline
                    className="chart-line chart-line-muted"
                    points="0,118 70,112 140,96 210,104 280,82 350,90 420,68 490,78 560,64"
                  />
                </svg>
              </div>
            </div>
            <aside>
              <div className="saas-preview-section-title">
                <strong>待办事项</strong>
                <span>4 项</span>
              </div>
              <ul>
                <li>
                  <i className="high" />
                  处理排名下降问题 <b>7</b>
                </li>
                <li>
                  <i />
                  审核生成内容 <b>3</b>
                </li>
                <li>
                  <i />
                  跟进发布订单 <b>2</b>
                </li>
              </ul>
            </aside>
          </div>
        </div>
      </section>

      <section className="saas-home-capabilities" aria-label="平台能力">
        {capabilities.map(([title, description], index) => (
          <article key={title}>
            <span>0{index + 1}</span>
            <div>
              <h2>{title}</h2>
              <p>{description}</p>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
