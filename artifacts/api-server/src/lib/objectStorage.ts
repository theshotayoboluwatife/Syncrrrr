import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
  type StoredObject,
} from "./objectAcl";
import { supabaseAdmin } from "./auth";

const DEFAULT_STORAGE_BUCKET = "syncr-uploads";
const DEFAULT_CACHE_TTL_SEC = 3600;

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  private bucketReady: Promise<string> | null = null;

  async searchPublicObject(filePath: string): Promise<StoredObject | null> {
    const storagePath = toStoragePath(`/public-objects/${filePath}`);
    const objectFile = await this.getObjectByStoragePath(storagePath);
    return objectFile;
  }

  async downloadObject(
    objectFile: StoredObject,
    cacheTtlSec: number = DEFAULT_CACHE_TTL_SEC,
  ): Promise<Response> {
    const bucket = await this.ensureBucket();
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .download(objectFile.storagePath);

    if (error || !data) {
      throw new ObjectNotFoundError();
    }

    const headers: Record<string, string> = {
      "Content-Type":
        objectFile.contentType || data.type || "application/octet-stream",
      "Cache-Control": `${objectFile.isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };

    if (objectFile.size) {
      headers["Content-Length"] = String(objectFile.size);
    }

    return new Response(data.stream(), { headers });
  }

  async createObjectEntityUploadTarget({
    contentType,
  }: {
    contentType?: string;
  } = {}): Promise<{ uploadURL: string; objectPath: string }> {
    const bucket = await this.ensureBucket();
    const objectPath = `/objects/uploads/${randomUUID()}`;
    const storagePath = toStoragePath(objectPath);
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUploadUrl(storagePath, { upsert: false });

    if (error || !data) {
      throw error ?? new Error("Failed to create Supabase Storage upload URL");
    }

    return {
      uploadURL: data.signedUrl,
      objectPath,
    };
  }

  async getObjectEntityFile(objectPath: string): Promise<StoredObject> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const storagePath = toStoragePath(objectPath);
    const objectFile = await this.getObjectByStoragePath(storagePath);
    if (!objectFile) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (rawPath.startsWith("/objects/")) {
      return rawPath;
    }

    if (rawPath.startsWith("/api/storage/objects/")) {
      return rawPath.replace(/^\/api\/storage/, "");
    }

    try {
      const url = new URL(rawPath);
      const objectPath = url.pathname.replace(/^\/api\/storage/, "");
      return objectPath.startsWith("/objects/") ? objectPath : rawPath;
    } catch {
      return rawPath;
    }
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/objects/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: StoredObject;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  private async getObjectByStoragePath(
    storagePath: string,
  ): Promise<StoredObject | null> {
    const bucket = await this.ensureBucket();
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .info(storagePath);

    if (error || !data) {
      return null;
    }

    return {
      objectPath: toObjectPath(storagePath),
      storagePath,
      bucket,
      name: data.name ?? storagePath.split("/").at(-1) ?? storagePath,
      size: data.size,
      contentType: data.contentType,
      metadata: data.metadata as Record<string, unknown> | undefined,
      isPublic: storagePath.startsWith("public/"),
    };
  }

  private async ensureBucket(): Promise<string> {
    if (!this.bucketReady) {
      this.bucketReady = ensureStorageBucket();
    }
    return this.bucketReady;
  }
}

function getStorageBucketName(): string {
  return process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_STORAGE_BUCKET;
}

async function ensureStorageBucket(): Promise<string> {
  const bucket = getStorageBucketName();
  const existing = await supabaseAdmin.storage.getBucket(bucket);
  if (!existing.error) {
    return bucket;
  }

  const created = await supabaseAdmin.storage.createBucket(bucket, {
    public: false,
  });

  if (created.error) {
    throw created.error;
  }

  return bucket;
}

function toStoragePath(objectPath: string): string {
  const normalizedPath = objectPath.replace(/^\/+/, "");
  if (normalizedPath.startsWith("objects/")) {
    return normalizedPath.slice("objects/".length);
  }
  if (normalizedPath.startsWith("public-objects/")) {
    return `public/${normalizedPath.slice("public-objects/".length)}`;
  }
  throw new ObjectNotFoundError();
}

function toObjectPath(storagePath: string): string {
  if (storagePath.startsWith("public/")) {
    return `/public-objects/${storagePath.slice("public/".length)}`;
  }
  return `/objects/${storagePath}`;
}
