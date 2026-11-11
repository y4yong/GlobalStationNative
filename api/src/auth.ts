import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { pool } from './db.js';
import { trackSignupCode } from './engagement.js';

export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8),
});
export const registerRequestSchema = registerSchema.extend({
  referralCode: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/).optional(),
  adPersonalizationEnabled: z.boolean().default(false),
  adAgeRange: z.enum(['18-24', '25-34', '35-44', '45+']).nullable().default(null),
  adGender: z.enum(['WOMAN', 'MAN', 'NON_BINARY', 'PREFER_NOT_TO_SAY']).nullable().default(null),
}).superRefine((input, context) => {
  if (!input.adPersonalizationEnabled) return;
  if (!input.adAgeRange) {
    context.addIssue({ code: 'custom', path: ['adAgeRange'], message: 'Choose an age range to enable personalized ads.' });
  }
  if (!input.adGender) {
    context.addIssue({ code: 'custom', path: ['adGender'], message: 'Choose a gender option to enable personalized ads.' });
  }
});
export type UserRole = 'VIEWER' | 'CREATOR' | 'ADVERTISER' | 'ADMIN';
export interface LoginResult { token: string; role: UserRole; roles: UserRole[]; expiresAt: string }
export interface AuthenticatedUser { id: string; name: string; email: string; role: UserRole; roles: UserRole[]; isVip: boolean; coinBalance: number; locationAnalyticsEnabled: boolean; adPersonalizationEnabled: boolean; adAgeRange: string | null; adGender: string | null }
interface AuthenticatedRequest extends Request { authenticatedUser?: AuthenticatedUser }
interface RegistrationAdPreferences {
  enabled: boolean;
  ageRange: '18-24' | '25-34' | '35-44' | '45+' | null;
  gender: 'WOMAN' | 'MAN' | 'NON_BINARY' | 'PREFER_NOT_TO_SAY' | null;
}

const sessionLifetimeSeconds = 60 * 60 * 24 * 7;

function createSession(user: Pick<AuthenticatedUser, 'id' | 'role'> & { roles?: UserRole[] }): LoginResult {
  const roles = Array.from(new Set(user.roles ?? [user.role]));
  return {
    token: jwt.sign({ sub: user.id, role: user.role, roles }, config.JWT_SECRET, { expiresIn: sessionLifetimeSeconds }),
    role: user.role,
    roles,
    expiresAt: new Date(Date.now() + sessionLifetimeSeconds * 1000).toISOString(),
  };
}

export async function register(
  name: string,
  email: string,
  password: string,
  referralCode?: string,
  adPreferences: RegistrationAdPreferences = { enabled: false, ageRange: null, gender: null },
): Promise<LoginResult | null> {
  const passwordHash = await bcrypt.hash(password, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string; role: UserRole }>(
      `INSERT INTO users (
        name, email, password_hash, role,
        ad_personalization_enabled, ad_age_range, ad_gender
      ) VALUES ($1, lower($2), $3, $4, $5, $6, $7)
      ON CONFLICT (email) DO NOTHING
      RETURNING id, role`,
      [
        name.trim(), email, passwordHash, 'VIEWER',
        adPreferences.enabled,
        adPreferences.enabled ? adPreferences.ageRange : null,
        adPreferences.enabled ? adPreferences.gender : null,
      ],
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    await trackSignupCode(client, rows[0].id, referralCode);
    await client.query('COMMIT');
    return createSession({ ...rows[0], roles: ['VIEWER'] });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function upgradeRole(userId: string, role: 'CREATOR' | 'ADVERTISER'): Promise<LoginResult | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string; role: UserRole; status: string }>(
      'SELECT id, role, status FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    const user = rows[0];
    if (!user || user.status !== 'ACTIVE' || user.role === 'ADMIN') {
      await client.query('ROLLBACK');
      return null;
    }
    const primaryRole = user.role === 'VIEWER' ? role : user.role;
    if (user.role === 'VIEWER') {
      await client.query('UPDATE users SET role = $1, updated_at = now() WHERE id = $2', [role, userId]);
    }
    await client.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, role]);
    const roleResult = await client.query<{ role: UserRole }>('SELECT role FROM user_roles WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
    return createSession({ id: userId, role: primaryRole, roles: [primaryRole, ...roleResult.rows.map(row => row.role)] });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function login(email: string, password: string): Promise<LoginResult | null> {
  const { rows } = await pool.query<{ id: string; password_hash: string; role: UserRole; status: string; roles: UserRole[] }>(`SELECT id, password_hash, role, status, ARRAY(SELECT role FROM user_roles WHERE user_id = users.id) AS roles FROM users WHERE lower(email) = lower($1)`, [email]);
  const user = rows[0];
  if (!user || user.status !== 'ACTIVE' || !(await bcrypt.compare(password, user.password_hash))) return null;
  return createSession({ ...user, roles: [user.role, ...user.roles] });
}

export async function requireAuthenticated(request: Request, response: Response, next: NextFunction) {
  const token = request.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) {
    response.status(401).json({ error: 'AUTHENTICATION_REQUIRED' });
    return;
  }

  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as { sub?: string };
    if (!payload.sub) {
      response.status(401).json({ error: 'INVALID_TOKEN' });
      return;
    }
    const { rows } = await pool.query<{
      id: string;
      name: string;
      email: string;
      role: UserRole;
      roles: UserRole[];
      is_vip: boolean;
      coin_balance: number;
      location_analytics_enabled: boolean;
      ad_personalization_enabled: boolean;
      ad_age_range: string | null;
      ad_gender: string | null;
      status: string;
    }>(`SELECT     id, name, email, role, status, coin_balance,
        ARRAY(SELECT role FROM user_roles WHERE user_id = users.id) AS roles,
        location_analytics_enabled,
        ad_personalization_enabled, ad_age_range, ad_gender,
        (is_vip OR EXISTS (
          SELECT 1 FROM subscriptions s
          WHERE s.user_id = users.id AND s.status = 'ACTIVE'
            AND (s.renews_at IS NULL OR s.renews_at > now())
        )) AS is_vip
      FROM users WHERE id = $1`, [payload.sub]);
    const user = rows[0];
    if (!user || user.status !== 'ACTIVE') {
      response.status(401).json({ error: 'ACCOUNT_UNAVAILABLE' });
      return;
    }
    (request as AuthenticatedRequest).authenticatedUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      roles: Array.from(new Set([user.role, ...user.roles])),
      isVip: user.is_vip,
      coinBalance: user.coin_balance,
      locationAnalyticsEnabled: user.location_analytics_enabled,
      adPersonalizationEnabled: user.ad_personalization_enabled,
      adAgeRange: user.ad_age_range,
      adGender: user.ad_gender,
    };
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      response.status(401).json({ error: 'INVALID_TOKEN' });
      return;
    }
    next(error);
  }
}

export function getAuthenticatedUser(request: Request): AuthenticatedUser {
  return (request as AuthenticatedRequest).authenticatedUser!;
}

export function hasRole(user: AuthenticatedUser, role: UserRole): boolean {
  return user.role === role || user.roles.includes(role);
}
