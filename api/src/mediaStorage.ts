import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { getSignedUrl as getCloudFrontSignedUrl } from '@aws-sdk/cloudfront-signer';
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl as getS3SignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';

let s3Client: S3Client | undefined;
const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const uploadDirectory = resolve(apiDirectory, config.MEDIA_LOCAL_DIR);
const uploadLifetimeSeconds = 600;

interface LocalUploadClaims {
  key: string;
  contentType: string;
  contentLength: number;
  expiresAt: number;
}

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

export function getMediaStorageDirectory() {
  return uploadDirectory;
}

function getPublicBaseUrl() {
  const rawBase = config.PUBLIC_API_URL ? config.PUBLIC_API_URL.replace(/\/$/, '') : `http://localhost:${config.PORT}`;
  if (config.NODE_ENV !== 'development') return rawBase;
  return rawBase.replace('localhost', '10.0.2.2').replace('127.0.0.1', '10.0.2.2');
}

function createLocalUploadUrl(key: string, contentType: string, contentLength: number) {
  const payload = Buffer.from(JSON.stringify({
    key,
    contentType,
    contentLength,
    expiresAt: Math.floor(Date.now() / 1000) + uploadLifetimeSeconds,
  } satisfies LocalUploadClaims)).toString('base64url');
  const signature = createHmac('sha256', config.JWT_SECRET).update(payload).digest('base64url');
  const baseUrl = getPublicBaseUrl();
  return `${baseUrl}/api/v1/media/local/${payload}.${signature}`;
}

function readLocalUploadToken(token: string): LocalUploadClaims {
  const separator = token.lastIndexOf('.');
  if (separator < 1) throw Object.assign(new Error('The upload URL is invalid.'), { statusCode: 403 });
  const payload = token.slice(0, separator);
  const suppliedSignature = Buffer.from(token.slice(separator + 1), 'base64url');
  const expectedSignature = createHmac('sha256', config.JWT_SECRET).update(payload).digest();
  if (suppliedSignature.length !== expectedSignature.length || !timingSafeEqual(suppliedSignature, expectedSignature)) {
    throw Object.assign(new Error('The upload URL is invalid.'), { statusCode: 403 });
  }
  let claims: LocalUploadClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LocalUploadClaims;
  } catch {
    throw Object.assign(new Error('The upload URL is invalid.'), { statusCode: 403 });
  }
  if (!claims.key || claims.key.includes('..') || !Number.isSafeInteger(claims.contentLength) || claims.contentLength < 1 || claims.expiresAt <= Date.now() / 1000) {
    throw Object.assign(new Error('The upload URL has expired or is invalid.'), { statusCode: 403 });
  }
  return claims;
}

function hasValidFileSignature(contentType: string, prefix: Buffer) {
  if (contentType === 'image/jpeg') return prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff;
  if (contentType === 'image/png') return prefix.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === 'image/webp') return prefix.length >= 12 && prefix.toString('ascii', 0, 4) === 'RIFF' && prefix.toString('ascii', 8, 12) === 'WEBP';
  if (contentType === 'video/mp4') return prefix.length >= 8 && prefix.toString('ascii', 4, 8) === 'ftyp';
  return false;
}

export async function storeLocalUpload(token: string, request: Readable, contentType: string, declaredLength: string | undefined) {
  const claims = readLocalUploadToken(token);
  if (contentType !== claims.contentType || (declaredLength && Number(declaredLength) !== claims.contentLength)) {
    request.resume();
    throw Object.assign(new Error('The uploaded file type or size does not match the upload request.'), { statusCode: 400 });
  }
  const maximumBytes = claims.key.includes('/poster/') ? 10 * 1024 * 1024 : config.MEDIA_UPLOAD_MAX_BYTES;
  if (claims.contentLength > maximumBytes) {
    request.resume();
    throw Object.assign(new Error('The uploaded file exceeds the configured size limit.'), { statusCode: 413 });
  }
  const destination = resolve(uploadDirectory, claims.key);
  if (!destination.startsWith(`${uploadDirectory}/`) && !destination.startsWith(`${uploadDirectory}\\`)) {
    request.resume();
    throw Object.assign(new Error('The upload destination is invalid.'), { statusCode: 403 });
  }
  await mkdir(dirname(destination), { recursive: true });
  let receivedBytes = 0;
  let prefix = Buffer.alloc(0);
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > claims.contentLength || receivedBytes > maximumBytes) {
        callback(Object.assign(new Error('The uploaded file exceeds the requested size.'), { statusCode: 413 }));
        return;
      }
      if (prefix.length < 12) prefix = Buffer.concat([prefix, chunk.subarray(0, 12 - prefix.length)]);
      callback(null, chunk);
    },
  });
  const output = createWriteStream(destination, { flags: 'wx' });
  let ownsDestination = false;
  output.once('open', () => { ownsDestination = true; });
  try {
    await pipeline(request, limiter, output);
    if (receivedBytes !== claims.contentLength || !hasValidFileSignature(claims.contentType, prefix)) {
      throw Object.assign(new Error('Uploaded file type or size is not valid.'), { statusCode: 400 });
    }
  } catch (error) {
    if (ownsDestination) await unlink(destination).catch(() => undefined);
    throw error;
  }
}

async function verifyLocalUpload(key: string, prefix: string, maximumBytes: number) {
  if (!key.startsWith(prefix) || key.includes('..')) {
    throw Object.assign(new Error('The uploaded object does not belong to this upload request.'), { statusCode: 403 });
  }
  const filePath = resolve(uploadDirectory, key);
  const file = await stat(filePath).catch(() => null);
  if (!file?.isFile() || file.size < 1 || file.size > maximumBytes) {
    throw Object.assign(new Error('The uploaded object is missing or exceeds the upload limit.'), { statusCode: 400 });
  }
  return `${getPublicBaseUrl()}/uploads/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export async function createCreatorUpload(userId: string, contentLength: number) {
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > config.MEDIA_UPLOAD_MAX_BYTES) {
    throw Object.assign(new Error('The selected video exceeds the configured upload limit.'), { statusCode: 413 });
  }
  const key = `creators/${userId}/${randomUUID()}.mp4`;
  if (config.MEDIA_STORAGE_DRIVER === 'local') {
    return { uploadUrl: createLocalUploadUrl(key, 'video/mp4', contentLength), objectKey: key, contentType: 'video/mp4', expiresInSeconds: uploadLifetimeSeconds };
  }
  const { client, bucket } = getStorageConfig();
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: 'video/mp4' });
  const uploadUrl = await getS3SignedUrl(client, command, {
    expiresIn: 600,
    signableHeaders: new Set(['content-type']),
  });
  return { uploadUrl, objectKey: key, contentType: 'video/mp4', expiresInSeconds: 600 };
}

export async function createCreatorPosterUpload(userId: string, contentType: string, contentLength: number) {
  const allowedTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
  const extension = allowedTypes[contentType as keyof typeof allowedTypes];
  const maximumBytes = 10 * 1024 * 1024;
  if (!extension) throw Object.assign(new Error('Poster files must be JPEG, PNG, or WebP.'), { statusCode: 400 });
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > maximumBytes) {
    throw Object.assign(new Error('Poster files must be no larger than 10 MB.'), { statusCode: 413 });
  }
  const key = `creators/${userId}/posters/${randomUUID()}.${extension}`;
  if (config.MEDIA_STORAGE_DRIVER === 'local') {
    return { uploadUrl: createLocalUploadUrl(key, contentType, contentLength), objectKey: key, contentType, expiresInSeconds: uploadLifetimeSeconds };
  }
  const { client, bucket } = getStorageConfig();
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, Metadata: { 'expected-size': String(contentLength) } });
  const uploadUrl = await getS3SignedUrl(client, command, { expiresIn: 600, signableHeaders: new Set(['content-type', 'x-amz-meta-expected-size']) });
  return { uploadUrl, objectKey: key, contentType, requiredHeaders: { 'x-amz-meta-expected-size': String(contentLength) }, expiresInSeconds: 600 };
}

export async function verifyCreatorPosterUpload(userId: string, objectKey: string) {
  const prefix = `creators/${userId}/posters/`;
  if (!objectKey.startsWith(prefix) || objectKey.includes('..')) {
    throw Object.assign(new Error('The uploaded poster does not belong to this creator.'), { statusCode: 403 });
  }
  if (config.MEDIA_STORAGE_DRIVER === 'local') return verifyLocalUpload(objectKey, prefix, 10 * 1024 * 1024);
  const { client, bucket } = getStorageConfig();
  const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
  const expectedSize = Number(result.Metadata?.['expected-size']);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(result.ContentType ?? '') || !result.ContentLength || result.ContentLength > 10 * 1024 * 1024 || expectedSize !== result.ContentLength) {
    throw Object.assign(new Error('Uploaded poster type or size is not allowed.'), { statusCode: 400 });
  }
  return `s3://${bucket}/${objectKey}`;
}

export async function verifyCreatorUpload(userId: string, objectKey: string) {
  const prefix = `creators/${userId}/`;
  if (!objectKey.startsWith(prefix) || objectKey.includes('..')) {
    throw Object.assign(new Error('The uploaded media key does not belong to this creator.'), { statusCode: 403 });
  }
  if (config.MEDIA_STORAGE_DRIVER === 'local') {
    return verifyLocalUpload(objectKey, prefix, config.MEDIA_UPLOAD_MAX_BYTES);
  }
  const { client, bucket } = getStorageConfig();
  const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
  if (result.ContentType !== 'video/mp4' || !result.ContentLength || result.ContentLength > config.MEDIA_UPLOAD_MAX_BYTES) {
    throw Object.assign(new Error('The uploaded object is missing, has an invalid type, or exceeds the upload limit.'), { statusCode: 400 });
  }
  return `s3://${bucket}/${objectKey}`;
}

export async function createAdvertiserUpload(userId: string, contentLength: number) {
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > config.MEDIA_UPLOAD_MAX_BYTES) {
    throw Object.assign(new Error('The selected video exceeds the configured upload limit.'), { statusCode: 413 });
  }
  const key = `advertisers/${userId}/${randomUUID()}.mp4`;
  if (config.MEDIA_STORAGE_DRIVER === 'local') {
    return { uploadUrl: createLocalUploadUrl(key, 'video/mp4', contentLength), objectKey: key, contentType: 'video/mp4', expiresInSeconds: uploadLifetimeSeconds };
  }
  const { client, bucket } = getStorageConfig();
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: 'video/mp4' });
  const uploadUrl = await getS3SignedUrl(client, command, { expiresIn: 600, signableHeaders: new Set(['content-type']) });
  return { uploadUrl, objectKey: key, contentType: 'video/mp4', expiresInSeconds: 600 };
}

export async function verifyAdvertiserUpload(userId: string, objectKey: string) {
  const prefix = `advertisers/${userId}/`;
  if (!objectKey.startsWith(prefix) || objectKey.includes('..')) {
    throw Object.assign(new Error('The uploaded media key does not belong to this advertiser.'), { statusCode: 403 });
  }
  if (config.MEDIA_STORAGE_DRIVER === 'local') return verifyLocalUpload(objectKey, prefix, config.MEDIA_UPLOAD_MAX_BYTES);
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
    if (config.MEDIA_STORAGE_DRIVER === 'local' && mediaReference.startsWith('http://')) {
      if (config.NODE_ENV === 'development') {
        return mediaReference.replace(/http:\/\/(localhost|127\.0\.0\.1)/, 'http://10.0.2.2');
      }
      return mediaReference;
    }
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

export function signAdminPlaybackUrl(mediaReference: string) {
  const playbackUrl = signPlaybackUrl(mediaReference);
  if (config.MEDIA_STORAGE_DRIVER === 'local' && config.NODE_ENV === 'development') {
    return playbackUrl.replace(/^http:\/\/10\.0\.2\.2(?=:\d+\/)/, 'http://localhost');
  }
  return playbackUrl;
}

export async function deleteStoredMediaReferences(mediaReferences: string[]) {
  const uniqueReferences = Array.from(new Set(mediaReferences.filter(Boolean)));
  await Promise.all(uniqueReferences.map(async (reference) => {
    if (reference.startsWith('s3://')) {
      const expectedPrefix = `s3://${config.AWS_S3_BUCKET}/`;
      if (!reference.startsWith(expectedPrefix)) return;
      const { client, bucket } = getStorageConfig();
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: reference.slice(expectedPrefix.length) }));
      return;
    }

    if (!reference.startsWith('http://')) return;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(reference);
    } catch {
      return;
    }
    const allowedHosts = new Set(['localhost', '127.0.0.1', '10.0.2.2']);
    if (!allowedHosts.has(parsedUrl.hostname) || parsedUrl.port !== String(config.PORT) || !parsedUrl.pathname.startsWith('/uploads/')) return;
    const key = parsedUrl.pathname.slice('/uploads/'.length).split('/').map(decodeURIComponent).join('/');
    if (!key || key.includes('..')) return;
    const filePath = resolve(uploadDirectory, key);
    if (!filePath.startsWith(`${uploadDirectory}/`) && !filePath.startsWith(`${uploadDirectory}\\`)) return;
    await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }));
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
  const objectKey = `admin/${adminId}/${purpose}/${randomUUID()}.${extension}`;
  if (config.MEDIA_STORAGE_DRIVER === 'local') {
    return {
      uploadUrl: createLocalUploadUrl(objectKey, contentType, contentLength),
      objectKey,
      contentType,
      requiredHeaders: {},
      expiresInSeconds: uploadLifetimeSeconds,
      maximumBytes,
    };
  }
  const { client, bucket } = getStorageConfig();
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
  const maximumBytes = purpose === 'poster' ? 10 * 1024 * 1024 : config.MEDIA_UPLOAD_MAX_BYTES;
  if (config.MEDIA_STORAGE_DRIVER === 'local') {
    return verifyLocalUpload(objectKey, prefix, maximumBytes);
  }
  const { client, bucket } = getStorageConfig();
  const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
  const allowedTypes = purpose === 'poster' ? ['image/jpeg', 'image/png', 'image/webp'] : ['video/mp4'];
  const expectedSize = Number(result.Metadata?.['expected-size']);
  if (!result.ContentType || !allowedTypes.includes(result.ContentType) || !result.ContentLength || result.ContentLength > maximumBytes || !Number.isSafeInteger(expectedSize) || expectedSize !== result.ContentLength) {
    throw Object.assign(new Error('Uploaded file type or size is not allowed.'), { statusCode: 400 });
  }
  return `s3://${bucket}/${objectKey}`;
}