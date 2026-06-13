import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

export const TEST_JWT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
export const TEST_JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

process.env.JWT_PUBLIC_KEY = TEST_JWT_PUBLIC_KEY;
process.env.JWT_PRIVATE_KEY = TEST_JWT_PRIVATE_KEY;
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';

export function signTestToken(payload: { sub: string; email: string; role: 'admin' | 'user' }) {
  return jwt.sign(payload, TEST_JWT_PRIVATE_KEY, { algorithm: 'RS256', expiresIn: '15m' });
}
