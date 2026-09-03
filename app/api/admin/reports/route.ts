import {
  addMonthsIso,
  db,
  ensureSchema,
  generateAccessCode,
  getSession,
  json,
  makeId,
  normalizeAccessCode,
  nowIso,
  sha256,
} from '@/lib/server';

export async function GET(request: Request) {
  await ensureSchema();
  if (!(await getSession(request, 'admin'))) {
    return json({ error: '请先登录管理后台。' }, { status: 401 });
  }
  const reports = await db()
    .prepare(
      `SELECT reports.id, reports.customer_name, reports.title, reports.summary,
              reports.status, reports.access_count, reports.last_access_at,
              reports.created_at, reports.updated_at,
              COALESCE(report_presentations.mode, 'text') AS content_mode,
              report_presentations.html_filename,
              access_codes.code_hint, access_codes.expires_at, access_codes.revoked_at,
              (SELECT COUNT(*) FROM attachments WHERE attachments.report_id = reports.id) AS attachment_count
       FROM reports
       LEFT JOIN report_presentations ON report_presentations.report_id = reports.id
       LEFT JOIN access_codes ON access_codes.id = (
         SELECT id FROM access_codes latest
         WHERE latest.report_id = reports.id
         ORDER BY latest.created_at DESC LIMIT 1
       )
       ORDER BY reports.updated_at DESC`,
    )
    .all();
  return json({ reports: reports.results });
}

export async function POST(request: Request) {
  await ensureSchema();
  if (!(await getSession(request, 'admin'))) {
    return json({ error: '请先登录管理后台。' }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    customerName?: string;
    title?: string;
    summary?: string;
    content?: string;
    contentMode?: string;
  };
  const customerName = (body.customerName ?? '').trim();
  const title = (body.title ?? '').trim();
  const summary = (body.summary ?? '').trim();
  const content = (body.content ?? '').trim();
  const contentMode = body.contentMode === 'html' ? 'html' : 'text';
  if (!customerName || !title || (contentMode === 'text' && !content)) {
    return json({ error: '客户称呼、方案标题和文字正文不能为空。' }, { status: 400 });
  }
  if (customerName.length > 80 || title.length > 160 || content.length > 100_000) {
    return json({ error: '部分文字内容超过允许长度。' }, { status: 400 });
  }

  const reportId = makeId('rpt');
  const codeId = makeId('code');
  const accessCode = generateAccessCode();
  const normalized = normalizeAccessCode(accessCode);
  const timestamp = nowIso();
  const expiresAt = addMonthsIso(3);
  await db().batch([
    db()
      .prepare(
        `INSERT INTO reports
         (id, customer_name, title, summary, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        reportId,
        customerName,
        title,
        summary,
        content,
        contentMode === 'html' ? 'archived' : 'active',
        timestamp,
        timestamp,
      ),
    db()
      .prepare(
        `INSERT INTO report_presentations (report_id, mode, updated_at)
         VALUES (?, ?, ?)`,
      )
      .bind(reportId, contentMode, timestamp),
    db()
      .prepare(
        `INSERT INTO access_codes
         (id, report_id, code_hash, code_hint, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        codeId,
        reportId,
        await sha256(normalized),
        accessCode.slice(-4),
        expiresAt,
        timestamp,
      ),
  ]);
  return json({ reportId, accessCode, expiresAt }, { status: 201 });
}
