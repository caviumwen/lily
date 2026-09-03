import { clearCookie, deleteSession, json } from '@/lib/server';

export async function POST(request: Request) {
  await deleteSession(request, 'admin');
  return json(
    { ok: true },
    { headers: { 'set-cookie': clearCookie(request, 'lp_admin') } },
  );
}
