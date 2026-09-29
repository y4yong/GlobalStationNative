import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  CORS_ORIGIN: z.string().default('*'),
  AWS_REGION: z.string().optional(),
  AWS_S3_BUCKET: z.string().optional(),
  CLOUDFRONT_DOMAIN: z.string().optional(),
  CLOUDFRONT_KEY_PAIR_ID: z.string().optional(),
  CLOUDFRONT_PRIVATE_KEY: z.string().optional(),
  MEDIA_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(5_000_000_000),
  BILLPLZ_API_KEY: z.string().optional(),
  BILLPLZ_COLLECTION_ID: z.string().optional(),
  BILLPLZ_X_SIGNATURE_KEY: z.string().optional(),
  BILLPLZ_MODE: z.enum(['sandbox', 'production']).default('sandbox'),
  BILLPLZ_MONTHLY_PRICE_SEN: z.coerce.number().int().positive().default(1490),
  BILLPLZ_YEARLY_PRICE_SEN: z.coerce.number().int().positive().default(11990),
  PUBLIC_API_URL: z.string().url().optional(),
});

export const config = envSchema.parse(process.env);
