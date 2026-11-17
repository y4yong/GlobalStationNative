import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  CORS_ORIGIN: z.string().default('*'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  MEDIA_STORAGE_DRIVER: z.enum(['local', 's3']).default(process.env.NODE_ENV === 'production' ? 's3' : 'local'),
  MEDIA_LOCAL_DIR: z.string().default('./uploads'),
  AWS_REGION: z.string().optional(),
  BEDROCK_STORY_MODEL_ID: z.string().trim().min(1).optional(),
  AWS_S3_BUCKET: z.string().optional(),
  CLOUDFRONT_DOMAIN: z.string().optional(),
  CLOUDFRONT_KEY_PAIR_ID: z.string().optional(),
  CLOUDFRONT_PRIVATE_KEY: z.string().optional(),
  MEDIA_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(5_000_000_000),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_MODE: z.enum(['test', 'live']).default('test'),
  VIP_MONTHLY_PRICE_SEN: z.coerce.number().int().positive().default(1490),
  VIP_YEARLY_PRICE_SEN: z.coerce.number().int().positive().default(11990),
  PUBLIC_API_URL: z.string().url().optional(),
});

export const config = envSchema.parse(process.env);
