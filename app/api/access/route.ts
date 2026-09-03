import {
  assertRateAllowed,
  clearRateLimit,
  createSession,
  db,
  ensureSchema,
  json,
  makeId,
  normalizeAccessCode,
  nowIso,
  recordRateFailure,
  sessionCookie,
  sha256,
} from '@/lib/server';

export async function POST(request: Request) {
  await ensureSchema();
  const rate = await assertRateAllowed(request, 'customer-access');
  if (!rate.allowed) {
    return json(
      { error: '尝试次数过多，请在15分钟后再试。' },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const normalized = normalizeAccessCode(body.code ?? '');
  if (normalized.length < 8) {
    return json({ error: '请输入完整的访问码。' }, { status: 400 });
  }

  const codeHash = await sha256(normalized);
  const code = await db()
    .prepare(
      `SELECT access_codes.report_id, access_codes.expires_at, access_codes.revoked_at,
              reports.status
       FROM access_codes
       JOIN reports ON reports.id = access_codes.report_id
       WHERE access_codes.code_hash = ?`,
    )
    .bind(codeHash)
    .first<{
      report_id: string;
      expires_at: string;
      revoked_at: string | null;
      status: string;
    }>();

  const valid =
    code &&
    !code.revoked_at &&
    code.status === 'active' &&
    new Date(code.expires_at) > new Date();

  if (!valid) {
    await recordRateFailure(rate.limiterKey);
    await db()
      .prepare(
        `INSERT INTO access_events (id, report_id, event_type, success, created_at)
         VALUES (?, ?, 'code_attempt', 0, ?)`,
      )
      .bind(makeId('evt'), code?.report_id ?? null, nowIso())
      .run();
    return json({ error: '访问码无效、已到期或已被撤销。' }, { status: 401 });
  }

  await clearRateLimit(rate.limiterKey);
  const session = await createSession('report', {
    reportId: code.report_id,
    hours: 24,
  });
  const timestamp = nowIso();
  await db().batch([
    db()
      .prepare(
        'UPDATE reports SET access_count = access_count + 1, last_access_at = ? WHERE id = ?',
      )
      .bind(timestamp, code.report_id),
    db()
      .prepare(
        `INSERT INTO access_events (id, report_id, event_type, success, created_at)
         VALUES (?, ?, 'code_attempt', 1, ?)`,
      )
      .bind(makeId('evt'), code.report_id, timestamp),
  ]);

  return json(
    { ok: true, redirect: '/report' },
    {
      headers: {
        'set-cookie': sessionCookie(request, 'lp_report', session.token, 86400),
      },
    },
  );
}
