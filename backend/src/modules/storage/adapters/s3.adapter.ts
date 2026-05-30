import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  type GetObjectCommandOutput,
  type ListObjectsV2CommandOutput,
  type PutObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";
import path from "path";
import { AppError } from "../../../utils/response";

export interface S3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  sslEnabled?: boolean;
}

export interface S3UploadResult {
  key: string;
  etag: string;
  size: number;
  url: string;
}

export interface S3Stats {
  totalBytes: number;
  fileCount: number;
  backendType: "s3" | "s3_compatible";
  bucket: string;
}

export class S3Adapter {
  private client: S3Client;
  private config: S3Config;

  constructor(config: S3Config) {
    this.config = config;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? false,
      tls: config.sslEnabled !== false,
    });
  }

  private async send<T>(command: any): Promise<T> {
    try {
      return (await this.client.send(command)) as T;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("Resolved credential object is not valid") ||
        message.includes("Credential") ||
        message.includes("credentials")
      ) {
        throw new AppError(
          "S3 storage credentials are invalid or incomplete",
          "CONFIG_ERROR",
          500
        );
      }

      throw error;
    }
  }

  private generateKey(projectId: string, originalFilename: string): string {
    const randomName = crypto.randomBytes(16).toString("hex");
    const ext = path.extname(originalFilename) || ".bin";
    const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, "").substring(0, 20);
    return `projects/${projectId}/${randomName}${safeExt}`;
  }

  async upload(
    projectId: string,
    buffer: Buffer,
    originalFilename: string,
    contentType?: string
  ): Promise<S3UploadResult> {
    const key = this.generateKey(projectId, originalFilename);

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || "application/octet-stream",
      ContentLength: buffer.length,
    });

    const result = await this.send<PutObjectCommandOutput>(command);

    return {
      key,
      etag: result.ETag || "",
      size: buffer.length,
      url: `s3://${this.config.bucket}/${key}`,
    };
  }

  async download(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    });

    const result = await this.send<GetObjectCommandOutput>(command);

    if (!result.Body) {
      throw new AppError("File not found in S3", "NOT_FOUND", 404);
    }

    // Convert stream to buffer
    const chunks: Buffer[] = [];
    const stream = result.Body as NodeJS.ReadableStream;

    return new Promise((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", (err: Error) => reject(err));
    });
  }

  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    });

    await this.send(command);
  }

  async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      });
      await this.send(command);
      return true;
    } catch {
      return false;
    }
  }

  async validateConnection(): Promise<void> {
    await this.send(
      new HeadBucketCommand({
        Bucket: this.config.bucket,
      })
    );
  }

  async getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  async getStats(): Promise<S3Stats> {
    let totalBytes = 0;
    let fileCount = 0;
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: this.config.bucket,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      });

      const result = await this.send<ListObjectsV2CommandOutput>(command);

      if (result.Contents) {
        for (const obj of result.Contents) {
          fileCount++;
          totalBytes += obj.Size || 0;
        }
      }

      continuationToken = result.NextContinuationToken;
    } while (continuationToken);

    return {
      totalBytes,
      fileCount,
      backendType: "s3",
      bucket: this.config.bucket,
    };
  }
}
