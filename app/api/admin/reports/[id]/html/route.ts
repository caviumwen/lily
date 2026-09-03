import { db, ensureSchema, files, getSession, json, makeId, nowIso } from '@/lib/server';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  await ensureSchema();
  if (!(await getSession(request, 'admin'))) {
    return json({ error: '请先登录管理后台。' }, { status: 401 });
  }

  const { id } = await context.params;
  const report = await db().prepare('SELECT id FROM reports WHERE id = ?').bind(id).first();
  if (!report) return json({ error: '方案不存在。' }, { status: 404 });

  const form = await request.formData();
  const upload = form.get('file');
  if (!(upload instanceof File)) {
    return json({ error: '请选择 HTML 文件。' }, { status: 400 });
  }
  const lowerName = upload.name.toLowerCase();
  if (
    upload.type !== 'text/html' &&
    !lowerName.endsWith('.html') &&
    !lowerName.endsWith('.htm')
  ) {
    return json({ error: '仅支持 .html 或 .htm 文件。' }, { status: 400 });
  }
  if (upload.size > 5 * 1024 * 1024) {
    return json({ error: 'HTML 文件不能超过5MB。' }, { status: 400 });
  }

  const existing = await db()
    .prepare('SELECT html_object_key FROM report_presentations WHERE report_id = ?')
    .bind(id)
    .first<{ html_object_key: string | null }>();
  const safeName = upload.name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120) || 'report.html';
  const objectKey = `${id}/html-${makeId('doc')}-${safeName}`;
  await files().put(objectKey, upload.stream(), {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
    customMetadata: { filename: upload.name, reportId: id, purpose: 'report-html' },
  });

  const timestamp = nowIso();
  await db()
    .prepare(
      `INSERT INTO report_presentations
       (report_id, mode, html_object_key, html_filename, html_size, updated_at)
       VALUES (?, 'html', ?, ?, ?, ?)
       ON CONFLICT(report_id) DO UPDATE SET
         mode = 'html',
         html_object_key = excluded.html_object_key,
         html_filename = excluded.html_filename,
         html_size = excluded.html_size,
         updated_at = excluded.updated_at`,
    )
    .bind(id, objectKey, upload.name.slice(0, 180), upload.size, timestamp)
    .run();
  await db().prepare('UPDATE reports SET updated_at = ? WHERE id = ?').bind(timestamp, id).run();

  if (existing?.html_object_key && existing.html_object_key !== objectKey) {
    await files().delete(existing.html_object_key);
  }
  return json({ filename: upload.name, size: upload.size }, { status: 201 });
}
