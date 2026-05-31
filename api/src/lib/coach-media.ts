import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { mkdir, unlink } from "node:fs/promises";
import { join } from "path";
import { env } from "./env";

type CoachMediaStorageMode = "s3" | "local";

function resolveCoachMediaStorageMode(): CoachMediaStorageMode {
  const explicit = env.coachAvatarStorageDriver;
  if (explicit === "s3") return "s3";
  if (explicit === "local") return "local";
  const hasS3Creds = Boolean(
    env.coachAvatarS3Endpoint &&
    env.coachAvatarS3Bucket &&
    env.coachAvatarS3AccessKeyId &&
    env.coachAvatarS3SecretAccessKey,
  );
  return hasS3Creds ? "s3" : "local";
}

export const coachMediaStorageMode = resolveCoachMediaStorageMode();

function createS3Client(): S3Client | null {
  if (coachMediaStorageMode !== "s3") return null;
  if (
    !env.coachAvatarS3Endpoint ||
    !env.coachAvatarS3Bucket ||
    !env.coachAvatarS3AccessKeyId ||
    !env.coachAvatarS3SecretAccessKey
  ) {
    throw new Error(
      "S3 avatar storage selected but S3 credentials are incomplete. " +
        "Set AWS_ENDPOINT_URL, AWS_S3_BUCKET_NAME/BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.",
    );
  }
  return new S3Client({
    region: env.coachAvatarS3Region,
    endpoint: env.coachAvatarS3Endpoint,
    forcePathStyle: env.coachAvatarS3UrlStyle === "path",
    credentials: {
      accessKeyId: env.coachAvatarS3AccessKeyId,
      secretAccessKey: env.coachAvatarS3SecretAccessKey,
    },
  });
}

const s3Client = createS3Client();

function buildS3Key(filename: string): string {
  const prefix = env.coachAvatarS3Prefix;
  return prefix ? `${prefix}/${filename}` : filename;
}

export function buildCoachMediaFilename(
  thinkificUserId: number,
  extension: string,
): string {
  return `coach-${thinkificUserId}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
}

async function bodyToUint8Array(body: unknown): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  if (body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer());
  }
  const withTransform = body as {
    transformToByteArray?: () => Promise<Uint8Array>;
  };
  if (typeof withTransform.transformToByteArray === "function") {
    return withTransform.transformToByteArray();
  }
  throw new Error("Unsupported S3 body type");
}

export async function saveCoachMedia(
  filename: string,
  file: File,
  contentType: string,
): Promise<void> {
  if (coachMediaStorageMode === "s3") {
    await s3Client!.send(
      new PutObjectCommand({
        Bucket: env.coachAvatarS3Bucket,
        Key: buildS3Key(filename),
        Body: new Uint8Array(await file.arrayBuffer()),
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    return;
  }

  await mkdir(env.coachUploadsDir, { recursive: true });
  await Bun.write(join(env.coachUploadsDir, filename), file);
}

export async function readCoachMedia(
  filename: string,
): Promise<Response | null> {
  if (coachMediaStorageMode === "s3") {
    try {
      const output = await s3Client!.send(
        new GetObjectCommand({
          Bucket: env.coachAvatarS3Bucket,
          Key: buildS3Key(filename),
        }),
      );
      if (!output.Body) return null;
      const payload = await bodyToUint8Array(output.Body);
      return new Response(new Uint8Array(payload), {
        headers: {
          "Content-Type": output.ContentType ?? "application/octet-stream",
          "Cache-Control":
            output.CacheControl ?? "public, max-age=31536000, immutable",
        },
      });
    } catch (err) {
      if (
        err instanceof S3ServiceException &&
        (err.name === "NoSuchKey" || err.$metadata.httpStatusCode === 404)
      ) {
        return null;
      }
      throw err;
    }
  }

  const file = Bun.file(join(env.coachUploadsDir, filename));
  if (!(await file.exists())) return null;
  return new Response(file, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

/**
 * Best-effort delete. Cleanup races (concurrent upload superseding the same
 * filename, S3 eventual consistency, missing local file) are non-fatal —
 * orphaned media is preferable to a failed user-facing request.
 */
export async function deleteCoachMedia(filename: string): Promise<void> {
  if (coachMediaStorageMode === "s3") {
    try {
      await s3Client!.send(
        new DeleteObjectCommand({
          Bucket: env.coachAvatarS3Bucket,
          Key: buildS3Key(filename),
        }),
      );
    } catch {
      // Intentionally swallowed to match local-mode behavior below.
    }
    return;
  }
  await unlink(join(env.coachUploadsDir, filename)).catch(() => {});
}
