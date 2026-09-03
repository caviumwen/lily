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

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  await ensureSchema();
  if (!(await getSession(request, 'admin'))) {
    return json({ error: '请先登录管理后台。' }, { status: 401 });
  }
  const { id } = await context.params;
  const report = await db().prepare('SELECT id FROM reports WHERE id = ?').bind(id).first();
  if (!report) return json({ error: '方案不存在。' }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  const action = body.action ?? 'regenerate';
  const timestamp = nowIso();

  if (action === 'revoke') {
    await db().batch([
      db()
        .prepare('UPDATE access_codes SET revoked_at = ? WHERE report_id = ? AND revoked_at IS NULL')
        .bind(timestamp, id),
      db()
        .prepare("DELETE FROM sessions WHERE session_type = 'report' AND report_id = ?")
        .bind(id),
    ]);
    return json({ ok: true });
  }

  if (action === 'renew') {
    const latest = await db()
      .prepare(
        'SELECT id, expires_at, revoked_at FROM access_codes WHERE report_id = ? ORDER BY created_at DESC LIMIT 1',
      )
      .bind(id)
      .first<{ id: string; expires_at: string; revoked_at: string | null }>();
    if (!latest || latest.revoked_at) {
      return json({ error: '当前没有可续期的访问码，请重新生成。' }, { status: 409 });
    }
    const base = new Date(latest.expires_at) > new Date() ? new Date(latest.expires_at) : new Date();
    const expiresAt = addMonthsIso(3, base);
    await db().prepare('UPDATE access_codes SET expires_at = ? WHERE id = ?').bind(expiresAt, latest.id).run();
    return json({ ok: true, expiresAt });
  }

  await db().batch([
    db()
      .prepare('UPDATE access_codes SET revoked_at = ? WHERE report_id = ? AND revoked_at IS NULL')
      .bind(timestamp, id),
    db()
      .prepare("DELETE FROM sessions WHERE session_type = 'report' AND report_id = ?")
      .bind(id),
  ]);
  const accessCode = generateAccessCode();
  const expiresAt = addMonthsIso(3);
  await db()
    .prepare(
      `INSERT INTO access_codes
       (id, report_id, code_hash, code_hint, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      makeId('code'),
      id,
      await sha256(normalizeAccessCode(accessCode)),
      accessCode.slice(-4),
      expiresAt,
      timestamp,
    )
    .run();
  return json({ accessCode, expiresAt });
}
