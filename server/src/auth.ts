import {
  createHash,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual
} from 'node:crypto';

const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SALT_BYTES = 16;
const DUMMY_SALT = Buffer.alloc(PASSWORD_SALT_BYTES, 0x53);

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      PASSWORD_KEY_LENGTH,
      { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => error ? reject(error) : resolve(derivedKey)
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const hash = await deriveKey(password, salt);
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const match = /^scrypt\$16384\$8\$1\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/.exec(encoded);
  if (!match) {
    await deriveKey(password, DUMMY_SALT);
    return false;
  }
  const salt = Buffer.from(match[1] ?? '', 'base64');
  const expected = Buffer.from(match[2] ?? '', 'base64');
  if (salt.length !== PASSWORD_SALT_BYTES || expected.length !== PASSWORD_KEY_LENGTH) {
    await deriveKey(password, DUMMY_SALT);
    return false;
  }
  const actual = await deriveKey(password, salt);
  return timingSafeEqual(actual, expected);
}

export async function performDummyPasswordCheck(password: string): Promise<void> {
  await deriveKey(password, DUMMY_SALT);
}

export function createCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashCode(challengeId: string, code: string): string {
  return createHash('sha256').update(`${challengeId}:${code}`).digest('hex');
}

export function codeMatches(challengeId: string, code: string, expectedHash: string): boolean {
  const candidate = Buffer.from(hashCode(challengeId, code), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function emailHint(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
}
