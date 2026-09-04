import {
  createHash,
  pbkdf2 as pbkdf2Callback,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2 = promisify(pbkdf2Callback);

export const PASSWORD_ITERATIONS = 210_000;

export function nowIso() {
  return new Date().toISOString();
}

export function addMonthsIso(months, source = new Date()) {
  const result = new Date(source);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result.toISOString();
}

export function makeId(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

export function randomToken(byteLength = 32) {
  return randomBytes(byteLength).toString('base64url');
}

export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export async function passwordHash(password, salt, iterations = PASSWORD_ITERATIONS) {
  const derived = await pbkdf2(password, salt, iterations, 32, 'sha256');
  return derived.toString('hex');
}

export function secureEqual(left, right) {
  const leftBuffer = Buffer.from(left || '', 'utf8');
  const rightBuffer = Buffer.from(right || '', 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function normalizeAccessCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function generateAccessCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  const raw = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export function parseCookies(request) {
  const cookies = new Map();
  for (const pair of String(request.headers.cookie || '').split(';')) {
    const [name, ...rest] = pair.trim().split('=');
    if (!name) continue;
    try {
      cookies.set(name, decodeURIComponent(rest.join('=')));
    } catch {
      cookies.set(name, rest.join('='));
    }
  }
  return cookies;
}

export function sessionCookie(name, value, maxAge) {
  const secure = process.env.COOKIE_SECURE !== 'false' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearCookie(name) {
  return sessionCookie(name, '', 0);
}

export function clientAddress(request) {
  return (
    request.headers['ali-real-client-ip'] ||
    request.headers['x-real-ip'] ||
    String(request.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    request.socket?.remoteAddress ||
    'unknown'
  );
}

