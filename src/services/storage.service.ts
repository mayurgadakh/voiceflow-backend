import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";
import { s3 } from "../config/storage.js";

const UPLOAD_URL_TTL_SECONDS = 15 * 60;

// ContentType and ContentLength are signed, so the browser can only upload exactly the declared file
export async function createUploadUrl(path: string, contentType: string, contentLength: number) {
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: path,
    ContentType: contentType,
    ContentLength: contentLength,
  });

  const signedUrl = await getSignedUrl(s3, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
  return signedUrl;
}

/** Returns the stored size in bytes, or null if the object does not exist. */
export async function getObjectSize(path: string) {
  try {
    const { ContentLength } = await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: path }));
    return ContentLength ?? null;
  } catch (err) {
    if ((err as { name?: string }).name === "NotFound") return null;
    throw err;
  }
}

export async function getObjectBytes(path: string) {
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: path }));
  if (!Body) throw new Error(`Empty object: ${path}`);
  return Body.transformToByteArray();
}

const PLAYBACK_URL_TTL_SECONDS = 60;

export function createPlaybackUrl(path: string) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: path }), {
    expiresIn: PLAYBACK_URL_TTL_SECONDS,
  });
}
