import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Env } from '../config/env.js';
import { resolvePemValue } from '../config/pem.js';

/** Claims embedded in every RS256 access token issued by the auth service. */
export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: 'admin' | 'user';
};

export type AccessTokenUser = {
  id: string;
  email: string;
  role: 'admin' | 'user';
};

function privateKey(env: Env): string {
  return resolvePemValue(env.JWT_PRIVATE_KEY);
}

function publicKey(env: Env): string {
  return resolvePemValue(env.JWT_PUBLIC_KEY);
}

/**
 * Signs a short-lived access token (default 15m) used as a Bearer credential.
 */
export function signAccessToken(
  user: AccessTokenUser,
  env: Env,
): string {
  const payload: AccessTokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
  };

  return jwt.sign(payload, privateKey(env), {
    algorithm: 'RS256',
    expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'],
  });
}

/**
 * Verifies an access token and returns the authenticated principal.
 * Throws if the token is missing, expired, or signed with the wrong key.
 */
export function verifyAccessToken(token: string, env: Env): AccessTokenUser {
  const payload = jwt.verify(token, publicKey(env), {
    algorithms: ['RS256'],
  }) as AccessTokenPayload;

  return {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
  };
}
