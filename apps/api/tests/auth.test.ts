import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { queryRead, queryWrite } from '../src/db/pools.js';
import { createLogger } from '../src/middleware/logger.js';
import { TEST_JWT_PUBLIC_KEY } from './helpers/jwt.js';
import { resetMockRedisStore } from './setup.js';

const ADMIN_PASSWORD = 'Admin123!';
const ADMIN_HASH = '$2b$12$lwF4xpuCpVbo2u/yLX/JP.tvv0ZifFXOZsYo50LcmExoq4wf6kIZ6';

type UserRow = {
  id: string;
  email: string;
  password_hash: string | null;
  name: string;
  role: 'admin' | 'user';
  email_verified_at: Date | null;
  google_id: string | null;
};

type VerificationRow = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
};

const users = new Map<string, UserRow>();
const usersByEmail = new Map<string, UserRow>();
const verificationTokens = new Map<string, VerificationRow>();

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function seedAdmin(): UserRow {
  const admin: UserRow = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'admin@arekta.local',
    password_hash: ADMIN_HASH,
    name: 'Admin User',
    role: 'admin',
    email_verified_at: new Date(),
    google_id: null,
  };
  users.set(admin.id, admin);
  usersByEmail.set(admin.email, admin);
  return admin;
}

function installDbMocks(): void {
  const handleReadQuery = async (sql: string, params?: unknown[]) => {
    if (sql.includes('FROM users WHERE email')) {
      const email = (params?.[0] as string).toLowerCase();
      const user = usersByEmail.get(email);
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
    }

    if (sql.includes('FROM users WHERE id')) {
      const id = params?.[0] as string;
      const user = users.get(id);
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
    }

    if (sql.includes('FROM users WHERE google_id')) {
      const googleId = params?.[0] as string;
      const user = [...users.values()].find((u) => u.google_id === googleId);
      return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
    }

    if (sql.includes('FROM email_verification_tokens WHERE token_hash')) {
      const tokenHash = params?.[0] as string;
      const row = [...verificationTokens.values()].find((t) => t.token_hash === tokenHash);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    return { rows: [], rowCount: 0 };
  };

  vi.mocked(queryRead).mockImplementation(handleReadQuery);

  vi.mocked(queryWrite).mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.trimStart().startsWith('SELECT')) {
      return handleReadQuery(sql, params);
    }

    if (sql.includes('INSERT INTO users')) {
      const user: UserRow = {
        id: crypto.randomUUID(),
        email: (params?.[0] as string).toLowerCase(),
        password_hash: params?.[1] as string | null,
        name: params?.[2] as string,
        role: (params?.[3] as 'admin' | 'user') ?? 'user',
        email_verified_at: (params?.[4] as Date | null) ?? null,
        google_id: (params?.[5] as string | null) ?? null,
      };
      users.set(user.id, user);
      usersByEmail.set(user.email, user);
      return { rows: [user], rowCount: 1 };
    }

    if (sql.includes('UPDATE users SET email_verified_at')) {
      const userId = params?.[0] as string;
      const user = users.get(userId);
      if (user) {
        user.email_verified_at = new Date();
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('UPDATE users') && sql.includes('google_id')) {
      const googleId = params?.[0] as string;
      const userId = params?.[1] as string;
      const user = users.get(userId);
      if (user) {
        user.google_id = googleId;
        user.email_verified_at = user.email_verified_at ?? new Date();
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('DELETE FROM email_verification_tokens WHERE user_id')) {
      const userId = params?.[0] as string;
      for (const [key, row] of verificationTokens) {
        if (row.user_id === userId) {
          verificationTokens.delete(key);
        }
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('INSERT INTO email_verification_tokens')) {
      const row: VerificationRow = {
        id: crypto.randomUUID(),
        user_id: params?.[0] as string,
        token_hash: params?.[1] as string,
        expires_at: params?.[2] as Date,
      };
      verificationTokens.set(row.id, row);
      return { rows: [row], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  });
}

const mockVerifyIdToken = vi.fn();

const { mockSendMail } = vi.hoisted(() => ({
  mockSendMail: vi.fn().mockResolvedValue({ messageId: 'test-message-id' }),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
    })),
  },
}));

const baseEnv = loadEnv();
const env = {
  ...baseEnv,
  LOG_LEVEL: 'silent' as const,
  GOOGLE_CLIENT_ID: 'test-google-client',
  EMAIL_PROVIDER: 'console' as const,
};
const logger = createLogger(env);
const app = createApp(env, logger);

describe('Auth routes', () => {
  beforeEach(() => {
    users.clear();
    usersByEmail.clear();
    verificationTokens.clear();
    resetMockRedisStore();
    installDbMocks();
    mockVerifyIdToken.mockReset();
    seedAdmin();
  });

  it('POST /auth/signup valid body returns 201 without passwordHash', async () => {
    const response = await request(app).post('/auth/signup').send({
      email: 'newuser@example.com',
      password: 'password123',
      name: 'New User',
    });

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({
      email: 'newuser@example.com',
      name: 'New User',
      role: 'user',
      emailVerified: false,
    });
    expect(response.body.user.passwordHash).toBeUndefined();
    expect(response.body.user.id).toBeDefined();
  });

  it('POST /auth/signup duplicate email returns 409 EMAIL_TAKEN', async () => {
    await request(app).post('/auth/signup').send({
      email: 'dup@example.com',
      password: 'password123',
      name: 'First',
    });

    const response = await request(app).post('/auth/signup').send({
      email: 'dup@example.com',
      password: 'password123',
      name: 'Second',
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('POST /auth/signup weak password returns 400', async () => {
    const response = await request(app).post('/auth/signup').send({
      email: 'weak@example.com',
      password: 'short',
      name: 'Weak Password',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /auth/login valid admin seed returns 200 with accessToken and Set-Cookie', async () => {
    const response = await request(app).post('/auth/login').send({
      email: 'admin@arekta.local',
      password: ADMIN_PASSWORD,
    });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toBeDefined();
    expect(response.headers['set-cookie']?.[0]).toMatch(/refreshToken=/);
  });

  it('POST /auth/login wrong password returns 401 INVALID_CREDENTIALS', async () => {
    const response = await request(app).post('/auth/login').send({
      email: 'admin@arekta.local',
      password: 'wrong-password',
    });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('POST /auth/login 5 failures then 6th returns 429 ACCOUNT_LOCKED', async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/auth/login').send({
        email: 'locked@example.com',
        password: 'wrong',
      });
    }

    const response = await request(app).post('/auth/login').send({
      email: 'locked@example.com',
      password: 'wrong',
    });

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('POST /auth/refresh valid cookie returns new accessToken and invalidates old refresh', async () => {
    const agent = request.agent(app);
    const login = await agent.post('/auth/login').send({
      email: 'admin@arekta.local',
      password: ADMIN_PASSWORD,
    });
    const oldCookie = login.headers['set-cookie']?.[0] as string;

    const refresh = await agent.post('/auth/refresh').set('Cookie', oldCookie);
    expect(refresh.status).toBe(200);
    expect(refresh.body.accessToken).toBeDefined();

    const reused = await request(app).post('/auth/refresh').set('Cookie', oldCookie);
    expect(reused.status).toBe(401);
    expect(reused.body.error.code).toBe('INVALID_REFRESH');
  });

  it('POST /auth/logout returns 204 and refresh no longer works', async () => {
    const agent = request.agent(app);
    await agent.post('/auth/login').send({
      email: 'admin@arekta.local',
      password: ADMIN_PASSWORD,
    });

    const logout = await agent.post('/auth/logout');
    expect(logout.status).toBe(204);

    const refresh = await agent.post('/auth/refresh');
    expect(refresh.status).toBe(401);
  });

  it('GET /auth/me with valid token returns 200 user profile', async () => {
    const login = await request(app).post('/auth/login').send({
      email: 'admin@arekta.local',
      password: ADMIN_PASSWORD,
    });

    const response = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe('admin@arekta.local');
    expect(response.body.user.role).toBe('admin');
  });

  it('GET /auth/me without token returns 401', async () => {
    const response = await request(app).get('/auth/me');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /auth/verify-email valid token sets email_verified_at', async () => {
    const signup = await request(app).post('/auth/signup').send({
      email: 'verify@example.com',
      password: 'password123',
      name: 'Verify Me',
    });

    const rawToken = 'test-verification-token';
    const userId = signup.body.user.id as string;
    verificationTokens.set('manual', {
      id: 'manual',
      user_id: userId,
      token_hash: hashToken(rawToken),
      expires_at: new Date(Date.now() + 60_000),
    });

    const response = await request(app)
      .get(`/auth/verify-email?token=${rawToken}`)
      .set('Accept', 'application/json');
    expect(response.status).toBe(200);
    expect(response.body.message).toContain('verified');

    const user = users.get(userId);
    expect(user?.email_verified_at).not.toBeNull();
  });

  it('GET /auth/verify-email expired token returns 400 INVALID_TOKEN', async () => {
    const signup = await request(app).post('/auth/signup').send({
      email: 'expired@example.com',
      password: 'password123',
      name: 'Expired',
    });

    const rawToken = 'expired-token';
    verificationTokens.set('expired', {
      id: 'expired',
      user_id: signup.body.user.id,
      token_hash: hashToken(rawToken),
      expires_at: new Date(Date.now() - 60_000),
    });

    const response = await request(app).get(`/auth/verify-email?token=${rawToken}`);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_TOKEN');
  });

  it('POST /auth/resend-verification for unverified user returns 200', async () => {
    await request(app).post('/auth/signup').send({
      email: 'resend@example.com',
      password: 'password123',
      name: 'Resend',
    });

    const login = await request(app).post('/auth/login').send({
      email: 'resend@example.com',
      password: 'password123',
    });

    const response = await request(app)
      .post('/auth/resend-verification')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.message).toContain('sent');
  });

  it('JWT payload contains role admin for seed admin login', async () => {
    const login = await request(app).post('/auth/login').send({
      email: 'admin@arekta.local',
      password: ADMIN_PASSWORD,
    });

    const payload = jwt.verify(login.body.accessToken, TEST_JWT_PUBLIC_KEY, {
      algorithms: ['RS256'],
    }) as { role: string; sub: string };

    expect(payload.role).toBe('admin');
    expect(payload.sub).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('POST /auth/google valid mock idToken returns 200 and auto-verifies new user', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: 'google-user-123',
        email: 'google@example.com',
        name: 'Google User',
      }),
    });

    const response = await request(app).post('/auth/google').send({
      idToken: 'mock-google-id-token',
    });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toBeDefined();
    expect(response.headers['set-cookie']?.[0]).toMatch(/refreshToken=/);

    const user = usersByEmail.get('google@example.com');
    expect(user?.google_id).toBe('google-user-123');
    expect(user?.email_verified_at).not.toBeNull();
  });
});

describe('Auth email (SMTP)', () => {
  beforeEach(() => {
    users.clear();
    usersByEmail.clear();
    verificationTokens.clear();
    resetMockRedisStore();
    installDbMocks();
    mockSendMail.mockClear();
    seedAdmin();
  });

  it('POST /auth/signup with EMAIL_PROVIDER=smtp sends verification email via nodemailer', async () => {
    const { resetEmailTransportForTests } = await import('../src/auth/email.js');
    resetEmailTransportForTests();

    const smtpEnv = {
      ...env,
      EMAIL_PROVIDER: 'smtp' as const,
      SMTP_HOST: 'localhost',
      SMTP_PORT: 1025,
      APP_URL: 'http://localhost:3000',
      EMAIL_FROM: 'noreply@arekta.local',
    };
    const smtpApp = createApp(smtpEnv, logger);

    const response = await request(smtpApp).post('/auth/signup').send({
      email: 'smtp-user@example.com',
      password: 'password123',
      name: 'SMTP User',
    });

    expect(response.status).toBe(201);
    expect(mockSendMail).toHaveBeenCalledOnce();

    const mailOptions = mockSendMail.mock.calls[0]?.[0] as {
      from: string;
      to: string;
      subject: string;
      text: string;
      html: string;
    };

    expect(mailOptions.from).toBe('noreply@arekta.local');
    expect(mailOptions.to).toBe('smtp-user@example.com');
    expect(mailOptions.subject).toContain('Verify');
    expect(mailOptions.text).toContain('http://localhost:3000/auth/verify-email?token=');
    expect(mailOptions.html).toContain('http://localhost:3000/auth/verify-email?token=');
  });
});
