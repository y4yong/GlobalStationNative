import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { pool } from './db.js';

export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
export const registerSchema = z.object({ name: z.string().trim().min(2).max(120), email: z.string().email(), password: z.string().min(8) });
export type UserRole = 'VIEWER' | 'CREATOR' | 'ADVERTISER' | 'ADMIN';
export interface LoginResult { token: string; role: UserRole; expiresAt: string }
export interface AuthenticatedUser { id: string; name: string; email: string; role: UserRole; isVip: boolean }
interface AuthenticatedRequest extends Request { authenticatedUser?: AuthenticatedUser }

const sessionLifetimeSeconds = 60 * 60 * 24 * 7;

function createSession(user: Pick<AuthenticatedUser, 'id' | 'role'>): LoginResult {
  return {
    token: jwt.sign({ sub: user.id, role: user.role }, config.JWT_SECRET, { expiresIn: sessionLifetimeSeconds }),
    role: user.role,
    expiresAt: new Date(Date.now() + sessionLifetimeSeconds * 1000).toISOString(),
  };
}

export async function register(name: string, email: string, password: string): Promise<LoginResult | null> {
  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query<{ id: string; role: UserRole }>(
    'INSERT INTO users (name, email, password_hash, role) VALUES ($1, lower($2), $3, \'VIEWER\') ON CONFLICT (email) DO NOTHING RETURNING id, role',
    [name.trim(), email, passwordHash],
  );
  return rows[0] ? createSession(rows[0]) : null;
}

export async function login(email: string, password: string): Promise<LoginResult | null> {
  const { rows } = await pool.query<{ id: string; password_hash: string; role: UserRole; status: string }>('SELECT id, password_hash, role, status FROM users WHERE lower(email) = lower($1)', [email]);
  const user = rows[0];
  if (!user || user.status !== 'ACTIVE' || !(await bcrypt.compare(password, user.password_hash))) return null;
  return createSession(user);
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
      is_vip: boolean;
      status: string;
    }>(`SELECT id, name, email, role, status,
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
