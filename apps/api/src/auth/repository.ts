import { createHash, randomBytes } from 'node:crypto';
import { queryRead, queryWrite } from '../db/pools.js';
import type { User } from '../db/schema.js';

/** Public user shape returned by auth endpoints (never includes passwordHash). */
export type AuthUserRecord = {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  emailVerified: boolean;
};

type UserRow = {
  id: string;
  email: string;
  password_hash: string | null;
  name: string;
  role: 'admin' | 'user';
  email_verified_at: Date | null;
  google_id: string | null;
};

type VerificationTokenRow = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
};

function mapUser(row: UserRow): AuthUserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    emailVerified: row.email_verified_at !== null,
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Persists a new local (email/password) user. Caller supplies the bcrypt hash.
 */
export async function createUser(input: {
  email: string;
  passwordHash: string | null;
  name: string;
  role?: 'admin' | 'user';
  emailVerifiedAt?: Date | null;
  googleId?: string | null;
}): Promise<AuthUserRecord> {
  const result = await queryWrite<UserRow>(
    `INSERT INTO users (email, password_hash, name, role, email_verified_at, google_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, email, password_hash, name, role, email_verified_at, google_id`,
    [
      input.email.toLowerCase(),
      input.passwordHash,
      input.name,
      input.role ?? 'user',
      input.emailVerifiedAt ?? null,
      input.googleId ?? null,
    ],
  );

  return mapUser(result.rows[0]);
}

/** Loads a user by email for login and signup duplicate checks. */
export async function findByEmail(email: string): Promise<(UserRow & { passwordHash: string | null }) | null> {
  const result = await queryRead<UserRow>(
    `SELECT id, email, password_hash, name, role, email_verified_at, google_id
     FROM users WHERE email = $1`,
    [email.toLowerCase()],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return { ...row, passwordHash: row.password_hash };
}

/** Loads a user by primary key — used after refresh rotation and /auth/me. */
export async function findById(id: string): Promise<AuthUserRecord | null> {
  const result = await queryRead<UserRow>(
    `SELECT id, email, password_hash, name, role, email_verified_at, google_id
     FROM users WHERE id = $1`,
    [id],
  );

  const row = result.rows[0];
  return row ? mapUser(row) : null;
}

/** Marks a user's email as verified and clears outstanding verification tokens. */
export async function setVerified(userId: string): Promise<void> {
  await queryWrite(
    `UPDATE users SET email_verified_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [userId],
  );
  await queryWrite(`DELETE FROM email_verification_tokens WHERE user_id = $1`, [userId]);
}

/**
 * Creates a single-use verification token. Returns the raw token (only sent via email).
 */
export async function createVerificationToken(
  userId: string,
  expiresInHours = 24,
): Promise<string> {
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  await queryWrite(
    `DELETE FROM email_verification_tokens WHERE user_id = $1`,
    [userId],
  );

  await queryWrite(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );

  return rawToken;
}

/** Resolves a raw verification token to its owning user, if valid and not expired. */
export async function findVerificationToken(
  rawToken: string,
): Promise<{ userId: string; expired: boolean } | null> {
  const tokenHash = hashToken(rawToken);
  const result = await queryRead<VerificationTokenRow>(
    `SELECT id, user_id, token_hash, expires_at
     FROM email_verification_tokens WHERE token_hash = $1`,
    [tokenHash],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    expired: row.expires_at.getTime() < Date.now(),
  };
}

/** Finds an existing Google-linked user or creates a new auto-verified account. */
export async function findOrCreateGoogleUser(input: {
  googleId: string;
  email: string;
  name: string;
}): Promise<AuthUserRecord> {
  const byGoogle = await queryRead<UserRow>(
    `SELECT id, email, password_hash, name, role, email_verified_at, google_id
     FROM users WHERE google_id = $1`,
    [input.googleId],
  );

  if (byGoogle.rows[0]) {
    return mapUser(byGoogle.rows[0]);
  }

  const byEmail = await findByEmail(input.email);
  if (byEmail) {
    await queryWrite(
      `UPDATE users
       SET google_id = $1, email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW()
       WHERE id = $2`,
      [input.googleId, byEmail.id],
    );
    const updated = await findById(byEmail.id);
    if (!updated) {
      throw new Error('Failed to load user after Google link');
    }
    return updated;
  }

  return createUser({
    email: input.email,
    passwordHash: null,
    name: input.name,
    googleId: input.googleId,
    emailVerifiedAt: new Date(),
  });
}

/** Type alias for repository consumers that need the full DB row. */
export type DbUser = User;
