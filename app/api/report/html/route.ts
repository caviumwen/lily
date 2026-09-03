import { db, ensureSchema, files, getSession, json } from '@/lib/server';

export async function GET(request: Request) {
  await ensureSchema();
  const session = await getSession(request, 'report');
  if (!session?.report_id) {
    return json({ error: '请先输入有效访问码。' }, { status: 401 });
  }

  const presentation = await db()
    .prepare(
      `SELECT report_presentations.html_object_key
       FROM report_presentations
       JOIN reports ON reports.id = report_presentations.report_id
       WHERE report_presentations.report_id = ?
         AND report_presentations.mode = 'html'
         AND report_presentations.html_object_key IS NOT NULL
         AND reports.status = 'active'`,
    )
    .bind(session.report_id)
    .first<{ html_object_key: string }>();
  if (!presentation) {
    return json({ error: '该 HTML 方案不存在或已暂停。' }, { status: 404 });
  }

  const object = await files().get(presentation.html_object_key);
  if (!object) return json({ error: 'HTML 文件不存在。' }, { status: 404 });

  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, no-store',
    'x-robots-tag': 'noindex, nofollow',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'SAMEORIGIN',
    'referrer-policy': 'no-referrer',
    'content-security-policy': [
      "default-src 'none'",
      "style-src 'self' 'unsafe-inline' https:",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https:",
      "media-src 'self' data: https:",
      "script-src 'none'",
      "connect-src 'none'",
      "object-src 'none'",
      "frame-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'none'",
      "base-uri 'none'",
    ].join('; '),
  });
  return new Response(object.body, { headers });
}
