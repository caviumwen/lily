import { db, ensureSchema, files, getSession, json, makeId, nowIso } from '@/lib/server';

const allowedTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
]);

export async function POST(request: Request) {
  await ensureSchema();
  if (!(await getSession(request, 'admin'))) {
    return json({ error: '请先登录管理后台。' }, { status: 401 });
  }
  const form = await request.formData();
  const reportId = String(form.get('reportId') ?? '');
  const upload = form.get('file');
  if (!reportId || !(upload instanceof File)) {
    return json({ error: '请选择要上传的文件。' }, { status: 400 });
  }
  const report = await db().prepare('SELECT id FROM reports WHERE id = ?').bind(reportId).first();
  if (!report) return json({ error: '方案不存在。' }, { status: 404 });
  if (!allowedTypes.has(upload.type)) {
    return json({ error: '仅支持 PDF、JPG、PNG、WebP 或 TXT 文件。' }, { status: 400 });
  }
  if (upload.size > 10 * 1024 * 1024) {
    return json({ error: '单个文件不能超过10MB。' }, { status: 400 });
  }

  const attachmentId = makeId('att');
  const safeName = upload.name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120) || 'attachment';
  const objectKey = `${reportId}/${attachmentId}-${safeName}`;
  await files().put(objectKey, upload.stream(), {
    httpMetadata: { contentType: upload.type },
    customMetadata: { filename: upload.name, reportId },
  });
  await db()
    .prepare(
      `INSERT INTO attachments
       (id, report_id, object_key, filename, content_type, size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      attachmentId,
      reportId,
      objectKey,
      upload.name.slice(0, 180),
      upload.type,
      upload.size,
      nowIso(),
    )
    .run();
  return json({ id: attachmentId, filename: upload.name }, { status: 201 });
}
