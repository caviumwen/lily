import {
  createSession,
  db,
  ensureSchema,
  json,
  makeId,
  nowIso,
  passwordHash,
  randomToken,
  sessionCookie,
} from '@/lib/server';

export async function POST(request: Request) {
  await ensureSchema();
  const existing = await db().prepare('SELECT COUNT(*) AS count FROM admins').first<{ count: number }>();
  if (Number(existing?.count ?? 0) > 0) {
    return json({ error: '管理员已经初始化。' }, { status: 409 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };
  const username = (body.username ?? '').trim();
  const password = body.password ?? '';
  if (username.length < 2 || password.length < 12) {
    return json({ error: '管理员名称至少2个字符，密码至少12个字符。' }, { status: 400 });
  }

  const salt = randomToken(20);
  const adminId = makeId('adm');
  await db()
    .prepare(
      `INSERT INTO admins (id, username, password_salt, password_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(adminId, username, salt, await passwordHash(password, salt), nowIso())
    .run();
  const session = await createSession('admin', { adminId, hours: 12 });
  return json(
    { ok: true },
    {
      headers: {
        'set-cookie': sessionCookie(request, 'lp_admin', session.token, 43200),
      },
    },
  );
}
