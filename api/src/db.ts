import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  host: new URL(config.DATABASE_URL).hostname,
  port: Number(new URL(config.DATABASE_URL).port || 3306),
  user: decodeURIComponent(new URL(config.DATABASE_URL).username),
  password: decodeURIComponent(new URL(config.DATABASE_URL).password),
  database: new URL(config.DATABASE_URL).pathname.slice(1),
  connectionLimit: 10,
  waitForConnections: true,
  connectTimeout: 5_000,
  queueLimit: 0,
  ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
});
