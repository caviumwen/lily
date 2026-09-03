import { createSession, db, ensureSchema, getSession, json, sessionCookie } from '@/lib/server';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  await ensureSchema();
  if (!(await getSession(request, 'admin'))) {
    return json({ error: '请先登录管理后台。' }, { status: 401 });
  }
  const { id } = await context.params;
  const report = await db().prepare('SELECT id FROM reports WHERE id = ?').bind(id).first();
  if (!report) return json({ error: '方案不存在。' }, { status: 404 });
  const session = await createSession('report', { reportId: id, hours: 1 });
  return json(
    { ok: true, redirect: '/report' },
    { headers: { 'set-cookie': sessionCookie(request, 'lp_report', session.token, 3600) } },
  );
}
