'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  CalendarClock,
  Code2,
  Copy,
  Eye,
  FilePlus2,
  FileText,
  KeyRound,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  ShieldOff,
  Upload,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type ReportListItem = {
  id: string;
  customer_name: string;
  title: string;
  summary: string;
  status: string;
  access_count: number;
  last_access_at: string | null;
  created_at: string;
  updated_at: string;
  code_hint: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  attachment_count: number;
  content_mode: 'text' | 'html';
  html_filename: string | null;
};

type Attachment = {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  created_at: string;
};

type Draft = {
  customerName: string;
  title: string;
  summary: string;
  content: string;
  status: string;
  attachments: Attachment[];
  contentMode: 'text' | 'html';
  htmlFilename: string | null;
};

const emptyDraft: Draft = {
  customerName: '',
  title: '',
  summary: '',
  content: '',
  status: 'active',
  attachments: [],
  contentMode: 'text',
  htmlFilename: null,
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const body = await response.text();
  let result: T & { error?: string };
  try {
    result = (body ? JSON.parse(body) : {}) as T & { error?: string };
  } catch {
    throw new Error('服务器响应异常，请稍后重试。');
  }
  if (!response.ok) throw new Error(result.error ?? '操作失败，请稍后重试。');
  return result;
}

export function AdminPortal() {
  const [mode, setMode] = useState<'loading' | 'setup' | 'login' | 'dashboard'>('loading');
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [generatedCode, setGeneratedCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [htmlFile, setHtmlFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadReports = useCallback(async () => {
    const result = await api<{ reports: ReportListItem[] }>('/api/admin/reports');
    setReports(result.reports);
  }, []);

  useEffect(() => {
    api<{ configured: boolean; authenticated: boolean }>('/api/admin/status')
      .then(async (status) => {
        if (!status.configured) return setMode('setup');
        if (!status.authenticated) return setMode('login');
        setMode('dashboard');
        await loadReports();
      })
      .catch((reason: Error) => setError(reason.message));
  }, [loadReports]);

  async function authenticate(event: FormEvent<HTMLFormElement>, setup: boolean) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') ?? '');
    if (setup && password !== String(data.get('confirmPassword') ?? '')) {
      setError('两次输入的密码不一致。');
      setBusy(false);
      return;
    }
    try {
      await api(setup ? '/api/admin/setup' : '/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: data.get('username'), password }),
      });
      setMode('dashboard');
      await loadReports();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    setMode('login');
    setReports([]);
  }

  function startNew() {
    setEditingId('new');
    setDraft(emptyDraft);
    setGeneratedCode(null);
    setHtmlFile(null);
    setError('');
  }

  async function editReport(id: string) {
    setBusy(true);
    setError('');
    try {
      const result = await api<{
        report: {
          customer_name: string;
          title: string;
          summary: string;
          content: string;
          status: string;
          attachments: Attachment[];
          content_mode: 'text' | 'html';
          html_filename: string | null;
        };
      }>(`/api/admin/reports/${id}`);
      setDraft({
        customerName: result.report.customer_name,
        title: result.report.title,
        summary: result.report.summary,
        content: result.report.content,
        status: result.report.status,
        attachments: result.report.attachments,
        contentMode: result.report.content_mode,
        htmlFilename: result.report.html_filename,
      });
      setEditingId(id);
      setGeneratedCode(null);
      setHtmlFile(null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (draft.contentMode === 'html' && !draft.htmlFilename && !htmlFile) {
        throw new Error('请选择要展示的 HTML 文件。');
      }
      let reportId = editingId;
      if (editingId === 'new') {
        const result = await api<{ reportId: string; accessCode: string; expiresAt: string }>(
          '/api/admin/reports',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(draft),
          },
        );
        reportId = result.reportId;
        setEditingId(reportId);
        setGeneratedCode({ code: result.accessCode, expiresAt: result.expiresAt });
      }
      if (reportId && reportId !== 'new' && draft.contentMode === 'html' && htmlFile) {
        const form = new FormData();
        form.set('file', htmlFile);
        await api(`/api/admin/reports/${reportId}/html`, { method: 'POST', body: form });
        setDraft((current) => ({ ...current, htmlFilename: htmlFile.name }));
        setHtmlFile(null);
      }
      if (reportId && reportId !== 'new') {
        await api(`/api/admin/reports/${reportId}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(draft),
        });
      }
      await loadReports();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function codeAction(id: string, action: 'renew' | 'regenerate' | 'revoke') {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ accessCode?: string; expiresAt?: string }>(
        `/api/admin/reports/${id}/code`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      );
      if (result.accessCode && result.expiresAt) {
        setGeneratedCode({ code: result.accessCode, expiresAt: result.expiresAt });
      }
      await loadReports();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function preview(id: string) {
    const result = await api<{ redirect: string }>(`/api/admin/reports/${id}/preview`, { method: 'POST' });
    window.open(result.redirect, '_blank', 'noopener,noreferrer');
  }

  async function uploadFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !editingId || editingId === 'new') return;
    setBusy(true);
    setError('');
    const form = new FormData();
    form.set('reportId', editingId);
    form.set('file', file);
    try {
      await api('/api/admin/files', { method: 'POST', body: form });
      await editReport(editingId);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  }

  async function deleteFile(id: string) {
    setBusy(true);
    try {
      await api(`/api/files/${id}`, { method: 'DELETE' });
      if (editingId && editingId !== 'new') await editReport(editingId);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'loading') {
    return <main className="state-page"><RefreshCw className="spin" /><p>正在打开管理后台…</p></main>;
  }

  if (mode === 'setup' || mode === 'login') {
    const setup = mode === 'setup';
    return (
      <main className="admin-auth-shell">
        <a className="brand" href="/"><span className="brand-mark">LP</span><span><strong>LilyPlan</strong><small>管理后台</small></span></a>
        <section className="admin-auth-card">
          <span className="key-icon"><KeyRound /></span>
          <p className="eyebrow">ADMIN CONSOLE</p>
          <h1>{setup ? '创建首位管理员' : '管理员登录'}</h1>
          <p>{setup ? '首次使用需要设置管理员名称和高强度密码。' : '登录后管理客户方案、附件和访问码。'}</p>
          <form onSubmit={(event) => authenticate(event, setup)}>
            <Label htmlFor="username">管理员名称</Label>
            <Input id="username" name="username" required autoComplete="username" />
            <Label htmlFor="password">密码</Label>
            <Input id="password" name="password" type="password" required minLength={12} autoComplete={setup ? 'new-password' : 'current-password'} />
            {setup ? <><Label htmlFor="confirmPassword">确认密码</Label><Input id="confirmPassword" name="confirmPassword" type="password" required minLength={12} autoComplete="new-password" /></> : null}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <Button type="submit" size="lg" disabled={busy}>{busy ? '请稍候…' : setup ? '创建并进入后台' : '登录'}</Button>
          </form>
          <a className="back-link" href="/"><ArrowLeft />返回客户入口</a>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <a className="brand" href="/"><span className="brand-mark">LP</span><span><strong>LilyPlan</strong><small>方案管理后台</small></span></a>
        <Button variant="ghost" onClick={logout}><LogOut />退出</Button>
      </header>

      <div className="admin-heading">
        <div><p className="eyebrow">CLIENT REPORTS</p><h1>客户方案</h1><p>集中维护方案内容、附件和三个月有效的访问码。</p></div>
        <Button size="lg" onClick={startNew}><Plus />新建方案</Button>
      </div>

      {generatedCode ? (
        <section className="code-reveal" role="status">
          <div><KeyRound /><span><strong>新访问码（仅显示本次）</strong><small>有效至 {new Date(generatedCode.expiresAt).toLocaleDateString('zh-CN')}</small></span></div>
          <code>{generatedCode.code}</code>
          <Button variant="outline" onClick={() => navigator.clipboard.writeText(generatedCode.code)}><Copy />复制</Button>
        </section>
      ) : null}
      {error ? <p className="admin-error" role="alert">{error}</p> : null}

      {editingId ? (
        <section className="editor-panel">
          <div className="editor-heading"><div><p className="eyebrow">REPORT EDITOR</p><h2>{editingId === 'new' ? '新建客户方案' : '编辑客户方案'}</h2></div><Button variant="ghost" onClick={() => setEditingId(null)}>关闭</Button></div>
          <form className="report-editor" onSubmit={saveReport}>
            <div className="field-row"><div><Label htmlFor="customerName">客户称呼</Label><Input id="customerName" value={draft.customerName} onChange={(e) => setDraft({ ...draft, customerName: e.target.value })} placeholder="例如：张女士" required /></div><div><Label htmlFor="reportTitle">方案标题</Label><Input id="reportTitle" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="例如：家庭保障与储蓄方案" required /></div></div>
            <div><Label htmlFor="summary">摘要</Label><Textarea id="summary" value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} placeholder="用两三句话概括方案重点" rows={3} /></div>
            <fieldset className="content-mode-fieldset">
              <legend>客户看到的内容形式</legend>
              <div className="content-mode-picker">
                <label className={draft.contentMode === 'text' ? 'selected' : ''}>
                  <input type="radio" name="contentMode" value="text" checked={draft.contentMode === 'text'} onChange={() => { setDraft({ ...draft, contentMode: 'text' }); setHtmlFile(null); }} />
                  <FileText />
                  <span><strong>文字内容</strong><small>系统自动按段落排版，适合快速填写评估与报价。</small></span>
                </label>
                <label className={draft.contentMode === 'html' ? 'selected' : ''}>
                  <input type="radio" name="contentMode" value="html" checked={draft.contentMode === 'html'} onChange={() => setDraft({ ...draft, contentMode: 'html' })} />
                  <Code2 />
                  <span><strong>上传 HTML</strong><small>客户验证后直接查看文件中的静态布局与样式。</small></span>
                </label>
              </div>
            </fieldset>
            {draft.contentMode === 'text' ? (
              <div><Label htmlFor="content">方案正文</Label><Textarea id="content" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} placeholder="粘贴评估、报价说明和建议。空一行可分段显示。" rows={14} required /></div>
            ) : (
              <div className="html-uploader">
                <div><Label htmlFor="htmlFile">HTML 方案文件</Label><p>支持单个 .html 或 .htm 文件，最大5MB。建议把样式写在文件内部；脚本、表单和数据请求会被安全禁用。</p></div>
                <label className="html-file-input" htmlFor="htmlFile"><Code2 /><span>{htmlFile?.name ?? draft.htmlFilename ?? '选择 HTML 文件'}</span><strong>{htmlFile || draft.htmlFilename ? '更换文件' : '浏览文件'}</strong></label>
                <input id="htmlFile" className="visually-hidden-file" type="file" accept=".html,.htm,text/html" onChange={(event) => setHtmlFile(event.target.files?.[0] ?? null)} />
              </div>
            )}
            <label className="status-check"><input type="checkbox" checked={draft.status === 'active'} onChange={(e) => setDraft({ ...draft, status: e.target.checked ? 'active' : 'archived' })} /><span><strong>允许客户访问</strong><small>关闭后，即使访问码未过期也无法查看</small></span></label>
            <div className="editor-actions"><Button type="submit" size="lg" disabled={busy}>{busy ? '保存中…' : editingId === 'new' ? '保存并生成访问码' : '保存修改'}</Button></div>
          </form>
          {editingId !== 'new' ? (
            <div className="file-manager">
              <div><h3>方案附件</h3><p>支持 PDF、JPG、PNG、WebP、TXT，单个文件不超过10MB。</p></div>
              <label className="upload-button"><Upload />上传附件<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.txt" onChange={uploadFile} disabled={busy} /></label>
              <div className="admin-file-list">{draft.attachments.map((file) => <div key={file.id}><FileText /><span>{file.filename}</span><a href={`/api/files/${file.id}`} target="_blank" rel="noreferrer">查看</a><button type="button" onClick={() => deleteFile(file.id)}>删除</button></div>)}</div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="report-list" aria-label="客户方案列表">
        {reports.length === 0 ? (
          <div className="empty-reports"><FilePlus2 /><h2>还没有客户方案</h2><p>创建第一份方案后，系统会自动生成三个月有效的访问码。</p><Button onClick={startNew}><Plus />新建方案</Button></div>
        ) : reports.map((report) => (
          <article className="report-row" key={report.id}>
            <div className="report-customer"><span>{report.customer_name.slice(0, 1)}</span><div><strong>{report.customer_name}</strong><small>{report.status === 'active' ? '可访问' : '已暂停'}</small></div></div>
            <div className="report-name"><strong>{report.title}</strong><small>{report.content_mode === 'html' ? 'HTML 页面' : '文字内容'} · {report.attachment_count} 个附件 · 已访问 {report.access_count} 次</small></div>
            <div className="code-status"><KeyRound /><span><strong>{report.revoked_at ? '访问码已撤销' : `尾号 · ${report.code_hint ?? '--'}`}</strong><small>{report.expires_at ? `有效至 ${new Date(report.expires_at).toLocaleDateString('zh-CN')}` : '暂无访问码'}</small></span></div>
            <div className="row-actions">
              <Button variant="ghost" size="sm" onClick={() => editReport(report.id)}><Pencil />编辑</Button>
              <Button variant="ghost" size="sm" onClick={() => preview(report.id)}><Eye />预览</Button>
              <Button variant="ghost" size="sm" onClick={() => codeAction(report.id, 'renew')} disabled={Boolean(report.revoked_at)}><CalendarClock />续期</Button>
              <Button variant="ghost" size="sm" onClick={() => codeAction(report.id, 'regenerate')}><RefreshCw />新码</Button>
              <Button variant="destructive" size="sm" onClick={() => codeAction(report.id, 'revoke')} disabled={Boolean(report.revoked_at)}><ShieldOff />撤销</Button>
            </div>
          </article>
        ))}
      </section>

      <footer className="admin-footer"><Users />单管理员第一版 · 所有客户内容均由服务端隔离</footer>
    </main>
  );
}
