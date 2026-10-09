import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { pool } from './db.js';

export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['VIEWER', 'CREATOR', 'ADVERTISER']).default('VIEWER'),
});
export type UserRole = 'VIEWER' | 'CREATOR' | 'ADVERTISER' | 'ADMIN';
export interface LoginResult { token: string; role: UserRole; roles: UserRole[]; expiresAt: string }
export interface AuthenticatedUser { id: string; name: string; email: string; role: UserRole; roles: UserRole[]; isVip: boolean }
interface AuthenticatedRequest extends Request { authenticatedUser?: AuthenticatedUser }

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

export async function register(name: string, email: string, password: string, role: UserRole = 'VIEWER'): Promise<LoginResult | null> {
  const passwordHash = await bcrypt.hash(password, 12);
  const safeRole: UserRole = role === 'CREATOR' || role === 'ADVERTISER' ? role : 'VIEWER';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string; role: UserRole }>(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, lower($2), $3, $4) ON CONFLICT (email) DO NOTHING RETURNING id, role',
      [name.trim(), email, passwordHash, safeRole],
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    if (safeRole === 'CREATOR' || safeRole === 'ADVERTISER') {
      await client.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING', [rows[0].id, safeRole]);
    }
    await client.query('COMMIT');
    return createSession({ ...rows[0], roles: [safeRole] });
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
      status: string;
    }>(`SELECT id, name, email, role, status,
        ARRAY(SELECT role FROM user_roles WHERE user_id = users.id) AS roles,
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
