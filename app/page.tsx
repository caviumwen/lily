import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react';

import { AccessForm } from './access-form';

export default function Home() {
  return (
    <main className="portal-shell">
      <header className="portal-header">
        <a className="brand" href="/" aria-label="LilyPlan 首页">
          <span className="brand-mark">LP</span>
          <span>
            <strong>LilyPlan</strong>
            <small>私人保障方案</small>
          </span>
        </a>
        <div className="privacy-note">
          <ShieldCheck aria-hidden="true" />
          加密访问
        </div>
      </header>

      <section className="access-stage" aria-labelledby="access-title">
        <div className="access-copy">
          <p className="eyebrow">PERSONAL INSURANCE REVIEW</p>
          <h1 id="access-title">查看您的专属保险评估</h1>
          <p className="intro">
            每份方案均独立保存。请输入顾问发送给您的访问码，验证后即可查看评估、报价与相关附件。
          </p>

          <div className="trust-list" aria-label="访问说明">
            <div>
              <LockKeyhole aria-hidden="true" />
              <span>
                <strong>专属访问</strong>
                只展示与当前访问码对应的方案
              </span>
            </div>
            <div>
              <ArrowRight aria-hidden="true" />
              <span>
                <strong>三个月有效</strong>
                到期后可联系顾问续期或更换访问码
              </span>
            </div>
          </div>
        </div>

        <AccessForm />
      </section>

      <footer className="portal-footer">
        <span>您的资料仅用于本次方案展示</span>
        <a href="/admin">管理入口</a>
      </footer>
    </main>
  );
}
