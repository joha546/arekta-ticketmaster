import bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import type pino from 'pino';
import type { Env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { sendVerificationEmail } from './email.js';
import { signAccessToken } from './jwt.js';
import { clearOnSuccess, isLocked, recordFailure } from './lockout.js';
import {
  createSession,
  rotateSession,
  revokeSession,
} from './refresh.js';
import * as authRepo from './repository.js';
import type { AuthUserRecord } from './repository.js';

const BCRYPT_COST = 12;

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

/**
 * Orchestrates all auth use cases: signup, login, token lifecycle, verification, and Google OAuth.
 */
export function createAuthService(env: Env, logger: pino.Logger) {
  const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

  async function issueTokens(user: AuthUserRecord): Promise<AuthTokens> {
    const accessToken = signAccessToken(
      { id: user.id, email: user.email, role: user.role },
      env,
    );
    const refreshToken = await createSession(user.id, env);
    return { accessToken, refreshToken };
  }

  /** Registers a new user, hashes the password, and sends a verification email. */
  async function signup(input: {
    email: string;
    password: string;
    name: string;
  }): Promise<{ user: AuthUserRecord }> {
    const existing = await authRepo.findByEmail(input.email);
    if (existing) {
      throw new AppError('Email is already registered', 409, 'EMAIL_TAKEN');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
    const user = await authRepo.createUser({
      email: input.email,
      passwordHash,
      name: input.name,
    });

    const verificationToken = await authRepo.createVerificationToken(user.id);
    await sendVerificationEmail(
      { to: user.email, name: user.name, token: verificationToken },
      env,
      logger,
    );

    return { user };
  }

  /** Authenticates email/password credentials and returns access + refresh tokens. */
  async function login(input: {
    email: string;
    password: string;
  }): Promise<AuthTokens> {
    if (await isLocked(input.email)) {
      throw new AppError('Account temporarily locked', 429, 'ACCOUNT_LOCKED');
    }

    const user = await authRepo.findByEmail(input.email);
    if (!user?.passwordHash) {
      await recordFailure(input.email);
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) {
      await recordFailure(input.email);
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    await clearOnSuccess(input.email);

    const profile = await authRepo.findById(user.id);
    if (!profile) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    return issueTokens(profile);
  }

  /** Rotates the refresh token and returns a new access token. */
  async function refresh(refreshToken: string): Promise<AuthTokens> {
    const { userId, newRefreshToken } = await rotateSession(refreshToken, env);
    const user = await authRepo.findById(userId);
    if (!user) {
      throw new AppError('Invalid or expired refresh token', 401, 'INVALID_REFRESH');
    }

    const accessToken = signAccessToken(
      { id: user.id, email: user.email, role: user.role },
      env,
    );

    return { accessToken, refreshToken: newRefreshToken };
  }

  /** Revokes the refresh session server-side. */
  async function logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) {
      await revokeSession(refreshToken);
    }
  }

  /** Returns the authenticated user's public profile. */
  async function getMe(userId: string): Promise<{ user: AuthUserRecord }> {
    const user = await authRepo.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404, 'NOT_FOUND');
    }
    return { user };
  }

  /** Confirms email ownership using the token from the verification link. */
  async function verifyEmail(rawToken: string): Promise<{ message: string }> {
    const match = await authRepo.findVerificationToken(rawToken);
    if (!match) {
      throw new AppError('Invalid verification token', 400, 'INVALID_TOKEN');
    }
    if (match.expired) {
      throw new AppError('Verification token has expired', 400, 'INVALID_TOKEN');
    }

    await authRepo.setVerified(match.userId);
    return { message: 'Email verified successfully' };
  }

  /** Re-sends the verification email for an authenticated, unverified user. */
  async function resendVerification(userId: string): Promise<{ message: string }> {
    const user = await authRepo.findByIdFromPrimary(userId);
    if (!user) {
      throw new AppError('User not found', 404, 'NOT_FOUND');
    }
    if (user.emailVerified) {
      return { message: 'Email is already verified' };
    }

    const verificationToken = await authRepo.createVerificationToken(userId);
    await sendVerificationEmail(
      { to: user.email, name: user.name, token: verificationToken },
      env,
      logger,
    );

    return { message: 'Verification email sent' };
  }

  /** Verifies a Google ID token and signs the user in (auto-verified on first signup). */
  async function googleLogin(idToken: string): Promise<AuthTokens> {
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch {
      throw new AppError('Invalid Google ID token', 401, 'INVALID_CREDENTIALS');
    }

    if (!payload?.sub || !payload.email) {
      throw new AppError('Invalid Google ID token', 401, 'INVALID_CREDENTIALS');
    }

    const user = await authRepo.findOrCreateGoogleUser({
      googleId: payload.sub,
      email: payload.email,
      name: payload.name ?? payload.email.split('@')[0] ?? 'User',
    });

    return issueTokens(user);
  }

  return {
    signup,
    login,
    refresh,
    logout,
    getMe,
    verifyEmail,
    resendVerification,
    googleLogin,
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
