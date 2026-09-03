'use client';

import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  Download,
  FileText,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';

import { Button } from '@/components/ui/button';

type Attachment = {
  id: string;
  filename: string;
  content_type: string;
  size: number;
};

type Report = {
  id: string;
  customer_name: string;
  title: string;
  summary: string;
  content: string;
  updated_at: string;
  attachments: Attachment[];
  content_mode: 'text' | 'html';
  html_filename: string | null;
};

function fileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function ReportView() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/report', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.text();
        let result: { report?: Report; error?: string };
        try {
          result = body ? JSON.parse(body) : {};
        } catch {
          throw new Error('服务器响应异常，请稍后重试。');
        }
        if (!response.ok || !result.report) throw new Error(result.error ?? '方案无法读取');
        setReport(result.report);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  async function logout() {
    await fetch('/api/report/logout', { method: 'POST' });
    window.location.assign('/');
  }

  if (error) {
    return (
      <main className="state-page">
        <div className="state-card">
          <ShieldCheck aria-hidden="true" />
          <h1>无法查看方案</h1>
          <p>{error}</p>
          <Button onClick={() => window.location.assign('/')}>重新输入访问码</Button>
        </div>
      </main>
    );
  }

  if (!report) {
    return (
      <main className="state-page">
        <LoaderCircle className="spin" aria-hidden="true" />
        <p>正在安全读取您的方案…</p>
      </main>
    );
  }

  if (report.content_mode === 'html') {
    return (
      <main className="html-report-shell">
        <header className="html-report-topbar">
          <a className="brand" href="/">
            <span className="brand-mark">LP</span>
            <span><strong>LilyPlan</strong><small>{report.customer_name} · 已验证访问</small></span>
          </a>
          <div className="html-report-title"><strong>{report.title}</strong><small>{report.html_filename}</small></div>
          <Button variant="ghost" onClick={logout}>
            <ArrowLeft aria-hidden="true" />
            退出方案
          </Button>
        </header>
        <iframe
          className="html-report-frame"
          src="/api/report/html"
          title={`${report.customer_name}的${report.title}`}
          sandbox=""
          referrerPolicy="no-referrer"
        />
      </main>
    );
  }

  return (
    <main className="report-shell">
      <header className="report-topbar">
        <a className="brand" href="/">
          <span className="brand-mark">LP</span>
          <span><strong>LilyPlan</strong><small>私人保障方案</small></span>
        </a>
        <Button variant="ghost" onClick={logout}>
          <ArrowLeft aria-hidden="true" />
          退出方案
        </Button>
      </header>

      <article className="report-paper">
        <div className="report-hero">
          <div>
            <p className="eyebrow">PERSONAL INSURANCE REVIEW</p>
            <p className="customer-label">致：{report.customer_name}</p>
            <h1>{report.title}</h1>
            {report.summary ? <p className="report-summary">{report.summary}</p> : null}
          </div>
          <div className="report-stamp">
            <ShieldCheck aria-hidden="true" />
            <span><strong>专属方案</strong>已验证访问</span>
          </div>
        </div>

        <section className="report-content" aria-label="方案正文">
          {report.content.split(/\n{2,}/).map((paragraph, index) => (
            <p key={`${index}-${paragraph.slice(0, 16)}`}>{paragraph}</p>
          ))}
        </section>

        {report.attachments.length ? (
          <section className="attachment-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">FILES</p>
                <h2>方案附件</h2>
              </div>
              <span>{report.attachments.length} 个文件</span>
            </div>
            <div className="attachment-list">
              {report.attachments.map((attachment) => (
                <a
                  className="attachment-row"
                  href={`/api/files/${attachment.id}`}
                  target="_blank"
                  rel="noreferrer"
                  key={attachment.id}
                >
                  <FileText aria-hidden="true" />
                  <span><strong>{attachment.filename}</strong><small>{fileSize(attachment.size)}</small></span>
                  <Download aria-hidden="true" />
                </a>
              ))}
            </div>
          </section>
        ) : null}

        <footer className="report-meta">
          <CalendarDays aria-hidden="true" />
          最近更新：{new Date(report.updated_at).toLocaleDateString('zh-CN')}
        </footer>
      </article>
    </main>
  );
}
