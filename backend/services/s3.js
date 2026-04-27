/**
 * КУДРИ · S3-клиент для Beget Cloud Storage.
 * Тонкая обёртка над @aws-sdk/client-s3. Конфиг — из .env.
 */

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const { log } = require('./logger');

const ENDPOINT = process.env.S3_ENDPOINT;
const BUCKET = process.env.S3_BUCKET;
const ACCESS_KEY = process.env.S3_ACCESS_KEY;
const SECRET_KEY = process.env.S3_SECRET_KEY;
const PHOTO_PREFIX = process.env.S3_PHOTO_PREFIX || 'kudri-photos/';

if (!ENDPOINT || !BUCKET || !ACCESS_KEY || !SECRET_KEY) {
  log.warn(null, '[s3]', 'S3_* env vars not fully set — photo features will fail');
}

const client = new S3Client({
  endpoint: ENDPOINT,
  region: 'us-east-1', // Beget игнорирует region, но aws-sdk требует значение
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  forcePathStyle: true
});

/**
 * Загружает буфер в S3. Возвращает ключ объекта.
 * subdir — поддиректория внутри PHOTO_PREFIX (например 'scans').
 */
async function uploadObject(buffer, contentType, subdir) {
  const ext = contentType === 'image/png' ? 'png' : 'jpg';
  const uuid = crypto.randomUUID();
  const key = `${PHOTO_PREFIX}${subdir}/${uuid}.${ext}`;
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType
  }));
  return key;
}

/**
 * Генерирует presigned GET URL на TTL секунд (default 3600).
 * Не делает запрос к S3, только локальная криптография.
 */
async function getPresignedUrl(key, ttlSeconds = 3600) {
  if (!key) return null;
  return getSignedUrl(client, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: ttlSeconds });
}

async function deleteObject(key) {
  if (!key) return;
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

module.exports = { uploadObject, getPresignedUrl, deleteObject };
