import { randomUUID } from 'node:crypto';
import { getSignedUrl as getCloudFrontSignedUrl } from '@aws-sdk/cloudfront-signer';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl as getS3SignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';

let s3Client: S3Client | undefined;

function unavailable(message: string) {
  return Object.assign(new Error(message), { statusCode: 503 });
}

function getStorageConfig() {
  if (!config.AWS_REGION || !config.AWS_S3_BUCKET) {
    throw unavailable('AWS media storage is not configured. Set AWS_REGION and AWS_S3_BUCKET.');
  }
  s3Client ??= new S3Client({ region: config.AWS_REGION });
  return { client: s3Client, bucket: config.AWS_S3_BUCKET };
}

export async function createCreatorUpload(userId: string, contentLength: number) {
  if (contentLength > config.MEDIA_UPLOAD_MAX_BYTES) {
    throw Object.assign(new Error('The selected video exceeds the configured upload limit.'), { statusCode: 413 });
  }
  const { client, bucket } = getStorageConfig();
  const key = `creators/${userId}/${randomUUID()}.mp4`;
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: 'video/mp4' });
  const uploadUrl = await getS3SignedUrl(client, command, {
    expiresIn: 600,
    signableHeaders: new Set(['content-type']),
  });
  return { uploadUrl, objectKey: key, contentType: 'video/mp4', expiresInSeconds: 600 };
}

export async function verifyCreatorUpload(userId: string, objectKey: string) {
  const prefix = `creators/${userId}/`;
  if (!objectKey.startsWith(prefix) || objectKey.includes('..')) {
    throw Object.assign(new Error('The uploaded media key does not belong to this creator.'), { statusCode: 403 });
  }
  const { client, bucket } = getStorageConfig();
  const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
  if (result.ContentType !== 'video/mp4' || !result.ContentLength || result.ContentLength > config.MEDIA_UPLOAD_MAX_BYTES) {
    throw Object.assign(new Error('The uploaded object is missing, has an invalid type, or exceeds the upload limit.'), { statusCode: 400 });
  }
  return `s3://${bucket}/${objectKey}`;
}

export function signPlaybackUrl(mediaReference: string) {
  if (!mediaReference.startsWith('s3://')) {
    if (mediaReference.startsWith('https://')) return mediaReference;
    throw Object.assign(new Error('The stored media reference is invalid.'), { statusCode: 500 });
  }

  if (!config.AWS_S3_BUCKET || !config.CLOUDFRONT_DOMAIN || !config.CLOUDFRONT_KEY_PAIR_ID || !config.CLOUDFRONT_PRIVATE_KEY) {
    throw unavailable('CloudFront playback signing is not configured. Set the CloudFront signing variables.');
  }
  const expectedPrefix = `s3://${config.AWS_S3_BUCKET}/`;
  if (!mediaReference.startsWith(expectedPrefix)) {
    throw Object.assign(new Error('The media object is outside the configured bucket.'), { statusCode: 403 });
  }
  const key = mediaReference.slice(expectedPrefix.length);
  const domain = config.CLOUDFRONT_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const url = `https://${domain}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const privateKey = config.CLOUDFRONT_PRIVATE_KEY.replace(/\\n/g, '\n');
  return getCloudFrontSignedUrl({
    url,
    keyPairId: config.CLOUDFRONT_KEY_PAIR_ID,
    privateKey,
    dateLessThan: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
}

export async function createAdminUpload(adminId: string, purpose: 'poster' | 'media', contentType: string, contentLength: number) {
  const allowedTypes = purpose === 'poster'
    ? { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
    : { 'video/mp4': 'mp4' };
  const extension = allowedTypes[contentType as keyof typeof allowedTypes];
  const maximumBytes = purpose === 'poster' ? 10 * 1024 * 1024 : config.MEDIA_UPLOAD_MAX_BYTES;
  if (!extension) {
    throw Object.assign(new Error(purpose === 'poster' ? 'Poster files must be JPEG, PNG, or WebP.' : 'Media files must be MP4.'), { statusCode: 400 });
  }
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > maximumBytes) {
    throw Object.assign(new Error(`File size must be between 1 byte and ${maximumBytes} bytes.`), { statusCode: 413 });
  }
  const { client, bucket } = getStorageConfig();
  const objectKey = `admin/${adminId}/${purpose}/${randomUUID()}.${extension}`;
  const command = new PutObjectCommand({ Bucket: bucket, Key: objectKey, ContentType: contentType, Metadata: { 'expected-size': String(contentLength) } });
  const uploadUrl = await getS3SignedUrl(client, command, {
    expiresIn: 600,
    signableHeaders: new Set(['content-type', 'x-amz-meta-expected-size']),
  });
  return { uploadUrl, objectKey, contentType, requiredHeaders: { 'x-amz-meta-expected-size': String(contentLength) }, expiresInSeconds: 600, maximumBytes };
}

export async function verifyAdminUpload(adminId: string, purpose: 'poster' | 'media', objectKey: string) {
  const prefix = `admin/${adminId}/${purpose}/`;
  if (!objectKey.startsWith(prefix) || objectKey.includes('..')) {
    throw Object.assign(new Error('The uploaded object does not belong to this admin upload request.'), { statusCode: 403 });
  }
  const { client, bucket } = getStorageConfig();
  const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
  const allowedTypes = purpose === 'poster' ? ['image/jpeg', 'image/png', 'image/webp'] : ['video/mp4'];
  const maximumBytes = purpose === 'poster' ? 10 * 1024 * 1024 : config.MEDIA_UPLOAD_MAX_BYTES;
  const expectedSize = Number(result.Metadata?.['expected-size']);
  if (!result.ContentType || !allowedTypes.includes(result.ContentType) || !result.ContentLength || result.ContentLength > maximumBytes || !Number.isSafeInteger(expectedSize) || expectedSize !== result.ContentLength) {
    throw Object.assign(new Error('Uploaded file type or size is not allowed.'), { statusCode: 400 });
  }
  return `s3://${bucket}/${objectKey}`;
}