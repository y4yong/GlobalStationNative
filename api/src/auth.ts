import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { RowDataPacket } from 'mysql2';
import { z } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const roles = ['VIEWER', 'CREATOR', 'ADVERTISER', 'ADMIN'] as const;
export type UserRole = (typeof roles)[number];

interface UserRow extends RowDataPacket {
  id: number;
  password_hash: string;
  role: UserRole;
}

export interface LoginResult {
  token: string;
  role: UserRole;
  expiresAt: string;
}

export async function login(email: string, password: string): Promise<LoginResult | null> {
  const [rows] = await pool.execute<UserRow[]>(
    'SELECT id, password_hash, role FROM users WHERE lower(email) = lower(?)',
    [email],
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return null;

  const expiresInSeconds = 60 * 60 * 24 * 7;
  const token = jwt.sign({ sub: user.id, role: user.role }, config.JWT_SECRET, { expiresIn: expiresInSeconds });
  return {
    token,
    role: user.role,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
  };
}
