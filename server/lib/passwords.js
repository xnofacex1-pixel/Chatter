import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

const N = 16384;
const r = 8;
const p = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

/** Hash a password with scrypt. Never stores the plaintext. */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { N, r, p, maxmem: MAX_MEMORY });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** Constant-time password verification. */
export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const parsedN = Number(parts[1]);
  const parsedR = Number(parts[2]);
  const parsedP = Number(parts[3]);
  if (!Number.isFinite(parsedN) || !Number.isFinite(parsedR) || !Number.isFinite(parsedP)) return false;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (salt.length === 0 || expected.length === 0) return false;
  const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
    N: parsedN,
    r: parsedR,
    p: parsedP,
    maxmem: MAX_MEMORY,
  });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwertyuiop', 'letmein123', 'iloveyou', 'chatter123', 'admin12345', 'welcome123',
]);

/** Returns an error message for a weak password, or null when acceptable. */
export function passwordProblem(password) {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < 10) return 'Password must be at least 10 characters long.';
  if (password.length > 200) return 'Password must be 200 characters or fewer.';
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'That password is too common. Choose something unique.';
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumberOrSymbol = /[^a-zA-Z]/.test(password);
  if (!hasLetter || !hasNumberOrSymbol) return 'Password must contain letters and at least one number or symbol.';
  return null;
}

/** Dummy verification used to keep login timing consistent for unknown accounts. */
export async function fakeVerify(password) {
  await scrypt(String(password ?? ''), Buffer.from('chatter-timing-salt'), KEY_LENGTH, { N, r, p, maxmem: MAX_MEMORY });
  return false;
}
