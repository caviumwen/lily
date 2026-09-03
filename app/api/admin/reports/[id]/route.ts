import { db, ensureSchema, getSession, json, nowIso } from '@/lib/server';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  await ensureSchema();
  if (!(await getSession(request, 'admin'))) {
    return json({ error: '请先登录管理后台。' }, { status: 401 });
  }
  const { id } = await context.params;
  const report = await db()
    .prepare(
      `SELECT reports.id, reports.customer_name, reports.title, reports.summary,
              reports.content, reports.status, reports.access_count,
              reports.last_access_at, reports.created_at, reports.updated_at,
              COALESCE(report_presentations.mode, 'text') AS content_mode,
              report_presentations.html_filename, report_presentations.html_size
       FROM reports
       LEFT JOIN report_presentations ON report_presentations.report_id = reports.id
       WHERE reports.id = ?`,
    )
    .bind(id)
    .first();
  if (!report) return json({ error: '方案不存在。' }, { status: 404 });
  const attachments = await db()
    .prepare(
      'SELECT id, filename, content_type, size, created_at FROM attachments WHERE report_id = ? ORDER BY created_at DESC',
    )
    .bind(id)
    .all();
  return json({ report: { ...report, attachments: attachments.results } });
}

export async function PUT(request: Request, context: RouteContext) {
  await ensureSchema();
  if (!(await getSession(request, 'admin'))) {
    return json({ error: '请先登录管理后台。' }, { status: 401 });
  }
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    customerName?: string;
    title?: string;
    summary?: string;
    content?: string;
    status?: string;
    contentMode?: string;
  };
  const customerName = (body.customerName ?? '').trim();
  const title = (body.title ?? '').trim();
  const summary = (body.summary ?? '').trim();
  const content = (body.content ?? '').trim();
  const status = body.status === 'archived' ? 'archived' : 'active';
  const contentMode = body.contentMode === 'html' ? 'html' : 'text';
  if (!customerName || !title || (contentMode === 'text' && !content)) {
    return json({ error: '客户称呼、方案标题和文字正文不能为空。' }, { status: 400 });
  }
  if (contentMode === 'html') {
    const html = await db()
      .prepare(
        'SELECT html_object_key FROM report_presentations WHERE report_id = ? AND html_object_key IS NOT NULL',
      )
      .bind(id)
      .first();
    if (!html) {
      return json({ error: '请先选择并上传 HTML 文件。' }, { status: 400 });
    }
  }
  const timestamp = nowIso();
  const result = await db().batch([
    db()
      .prepare(
        `UPDATE reports
         SET customer_name = ?, title = ?, summary = ?, content = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(customerName, title, summary, content, status, timestamp, id),
    db()
      .prepare(
        `INSERT INTO report_presentations (report_id, mode, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(report_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at`,
      )
      .bind(id, contentMode, timestamp),
  ]);
  if (!result[0].meta.changes) return json({ error: '方案不存在。' }, { status: 404 });
  if (status === 'archived') {
    await db()
      .prepare("DELETE FROM sessions WHERE session_type = 'report' AND report_id = ?")
      .bind(id)
      .run();
  }
  return json({ ok: true });
}
