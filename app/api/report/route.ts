import { db, ensureSchema, getSession, json } from '@/lib/server';

export async function GET(request: Request) {
  await ensureSchema();
  const session = await getSession(request, 'report');
  if (!session?.report_id) {
    return json({ error: '请先输入有效访问码。' }, { status: 401 });
  }

  const report = await db()
    .prepare(
      `SELECT reports.id, reports.customer_name, reports.title, reports.summary,
              reports.content, reports.updated_at,
              COALESCE(report_presentations.mode, 'text') AS content_mode,
              report_presentations.html_filename
       FROM reports
       LEFT JOIN report_presentations ON report_presentations.report_id = reports.id
       WHERE reports.id = ? AND reports.status = 'active'`,
    )
    .bind(session.report_id)
    .first<{
      id: string;
      customer_name: string;
      title: string;
      summary: string;
      content: string;
      updated_at: string;
      content_mode: 'text' | 'html';
      html_filename: string | null;
    }>();
  if (!report) return json({ error: '该方案已暂停查看。' }, { status: 404 });

  const attachments = await db()
    .prepare(
      `SELECT id, filename, content_type, size, created_at
       FROM attachments WHERE report_id = ? ORDER BY created_at DESC`,
    )
    .bind(report.id)
    .all();

  return json({ report: { ...report, attachments: attachments.results } });
}
