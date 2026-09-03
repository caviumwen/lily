import { db, ensureSchema, files, getSession, json } from '@/lib/server';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  await ensureSchema();
  const { id } = await context.params;
  const [adminSession, reportSession] = await Promise.all([
    getSession(request, 'admin'),
    getSession(request, 'report'),
  ]);
  const attachment = await db()
    .prepare(
      `SELECT attachments.id, attachments.report_id, attachments.object_key,
              attachments.filename, attachments.content_type, reports.status
       FROM attachments
       JOIN reports ON reports.id = attachments.report_id
       WHERE attachments.id = ?`,
    )
    .bind(id)
    .first<{
      id: string;
      report_id: string;
      object_key: string;
      filename: string;
      content_type: string;
      status: string;
    }>();
  if (!attachment) return json({ error: '文件不存在。' }, { status: 404 });
  if (
    !adminSession &&
    (reportSession?.report_id !== attachment.report_id || attachment.status !== 'active')
  ) {
    return json({ error: '无权查看该文件。' }, { status: 403 });
  }
  const object = await files().get(attachment.object_key);
  if (!object) return json({ error: '文件不存在。' }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('content-type', attachment.content_type);
  headers.set(
    'content-disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
  );
  headers.set('cache-control', 'private, no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(object.body, { headers });
}

export async function DELETE(request: Request, context: RouteContext) {
  await ensureSchema();
  if (!(await getSession(request, 'admin'))) {
    return json({ error: '请先登录管理后台。' }, { status: 401 });
  }
  const { id } = await context.params;
  const attachment = await db()
    .prepare('SELECT object_key FROM attachments WHERE id = ?')
    .bind(id)
    .first<{ object_key: string }>();
  if (!attachment) return json({ error: '文件不存在。' }, { status: 404 });
  await files().delete(attachment.object_key);
  await db().prepare('DELETE FROM attachments WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
