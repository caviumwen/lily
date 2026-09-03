import {
  assertRateAllowed,
  clearRateLimit,
  createSession,
  db,
  ensureSchema,
  json,
  passwordHash,
  recordRateFailure,
  sessionCookie,
} from '@/lib/server';

export async function POST(request: Request) {
  await ensureSchema();
  const rate = await assertRateAllowed(request, 'admin-login');
  if (!rate.allowed) {
    return json({ error: '登录失败次数过多，请在15分钟后再试。' }, { status: 429 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };
  const admin = await db()
    .prepare('SELECT id, password_salt, password_hash FROM admins WHERE username = ?')
    .bind((body.username ?? '').trim())
    .first<{ id: string; password_salt: string; password_hash: string }>();
  const supplied = admin
    ? await passwordHash(body.password ?? '', admin.password_salt)
    : '';
  if (!admin || supplied !== admin.password_hash) {
    await recordRateFailure(rate.limiterKey);
    return json({ error: '管理员名称或密码错误。' }, { status: 401 });
  }
  await clearRateLimit(rate.limiterKey);
  const session = await createSession('admin', { adminId: admin.id, hours: 12 });
  return json(
    { ok: true },
    {
      headers: {
        'set-cookie': sessionCookie(request, 'lp_admin', session.token, 43200),
      },
    },
  );
}
