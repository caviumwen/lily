import { env } from 'cloudflare:workers';

import { schemaStatements } from '@/db/schema';

type AppEnv = {
  DB: D1Database;
  FILES: R2Bucket;
};

let schemaReady: Promise<void> | null = null;

export function db() {
  return (env as unknown as AppEnv).DB;
}

export function files() {
  return (env as unknown as AppEnv).FILES;
}

export async function ensureSchema() {
  if (!schemaReady) {
    const database = db();
    schemaReady = database
      .batch(schemaStatements.map((statement) => database.prepare(statement)))
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  await schemaReady;
}

export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'private, no-store');
  headers.set('x-robots-tag', 'noindex, nofollow');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function nowIso() {
  return new Date().toISOString();
}

export function addMonthsIso(months: number, source = new Date()) {
  const result = new Date(source);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result.toISOString();
}

export function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function randomToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

export async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(salt),
      // Cloudflare Workers Web Crypto currently caps PBKDF2 at 100,000 rounds.
      iterations: 100_000,
    },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

export function normalizeAccessCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function generateAccessCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const raw = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function parseCookies(request: Request) {
  const cookies = new Map<string, string>();
  for (const pair of (request.headers.get('cookie') ?? '').split(';')) {
    const [name, ...rest] = pair.trim().split('=');
    if (name) cookies.set(name, decodeURIComponent(rest.join('=')));
  }
  return cookies;
}

export function sessionCookie(
  request: Request,
  name: string,
  value: string,
  maxAge: number,
) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearCookie(request: Request, name: string) {
  return sessionCookie(request, name, '', 0);
}

export async function createSession(
  sessionType: 'admin' | 'report',
  options: { adminId?: string; reportId?: string; hours: number },
) {
  await ensureSchema();
  const token = randomToken();
  const tokenHash = await sha256(token);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + options.hours * 3600_000);
  await db()
    .prepare(
      `INSERT INTO sessions
       (token_hash, session_type, report_id, admin_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      tokenHash,
      sessionType,
      options.reportId ?? null,
      options.adminId ?? null,
      expiresAt.toISOString(),
      createdAt.toISOString(),
    )
    .run();
  return { token, expiresAt };
}

export async function getSession(
  request: Request,
  sessionType: 'admin' | 'report',
) {
  await ensureSchema();
  const cookieName = sessionType === 'admin' ? 'lp_admin' : 'lp_report';
  const token = parseCookies(request).get(cookieName);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const session = await db()
    .prepare(
      `SELECT token_hash, session_type, report_id, admin_id, expires_at
       FROM sessions WHERE token_hash = ? AND session_type = ?`,
    )
    .bind(tokenHash, sessionType)
    .first<{
      token_hash: string;
      session_type: string;
      report_id: string | null;
      admin_id: string | null;
      expires_at: string;
    }>();
  if (!session || new Date(session.expires_at) <= new Date()) {
    if (session) {
      await db().prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    }
    return null;
  }
  return session;
}

export async function deleteSession(
  request: Request,
  sessionType: 'admin' | 'report',
) {
  await ensureSchema();
  const cookieName = sessionType === 'admin' ? 'lp_admin' : 'lp_report';
  const token = parseCookies(request).get(cookieName);
  if (token) {
    await db().prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  }
}

export function clientAddress(request: Request) {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'local'
  );
}

export async function assertRateAllowed(request: Request, scope: string) {
  await ensureSchema();
  const limiterKey = await sha256(`${scope}:${clientAddress(request)}`);
  const row = await db()
    .prepare('SELECT attempts, window_started_at, blocked_until FROM rate_limits WHERE limiter_key = ?')
    .bind(limiterKey)
    .first<{ attempts: number; window_started_at: string; blocked_until: string | null }>();
  if (row?.blocked_until && new Date(row.blocked_until) > new Date()) {
    return { allowed: false, limiterKey, retryAt: row.blocked_until };
  }
  return { allowed: true, limiterKey, retryAt: null };
}

export async function recordRateFailure(limiterKey: string) {
  const current = new Date();
  const windowStart = new Date(current.getTime() - 15 * 60_000);
  const existing = await db()
    .prepare('SELECT attempts, window_started_at FROM rate_limits WHERE limiter_key = ?')
    .bind(limiterKey)
    .first<{ attempts: number; window_started_at: string }>();
  const withinWindow = existing && new Date(existing.window_started_at) > windowStart;
  const attempts = withinWindow ? existing.attempts + 1 : 1;
  const startedAt = withinWindow ? existing.window_started_at : current.toISOString();
  const blockedUntil =
    attempts >= 5 ? new Date(current.getTime() + 15 * 60_000).toISOString() : null;
  await db()
    .prepare(
      `INSERT INTO rate_limits (limiter_key, attempts, window_started_at, blocked_until)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(limiter_key) DO UPDATE SET
         attempts = excluded.attempts,
         window_started_at = excluded.window_started_at,
         blocked_until = excluded.blocked_until`,
    )
    .bind(limiterKey, attempts, startedAt, blockedUntil)
    .run();
}

export async function clearRateLimit(limiterKey: string) {
  await db().prepare('DELETE FROM rate_limits WHERE limiter_key = ?').bind(limiterKey).run();
}
