import bcrypt from 'bcryptjs';

export function comparePassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export function verifyPassword(plain: string): boolean {
  const hash = process.env.AUTH_PASSWORD_HASH ?? '';
  return hash.length > 0 && comparePassword(plain, hash);
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}