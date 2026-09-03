import { db, ensureSchema, getSession, json } from '@/lib/server';

export async function GET(request: Request) {
  await ensureSchema();
  const row = await db().prepare('SELECT COUNT(*) AS count FROM admins').first<{ count: number }>();
  const session = await getSession(request, 'admin');
  return json({ configured: Number(row?.count ?? 0) > 0, authenticated: Boolean(session) });
}
