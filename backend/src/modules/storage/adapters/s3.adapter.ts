// S3 adapter skeleton - to be implemented when S3 storage is needed
// This provides the interface that S3-compatible storage backends will implement

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

export class S3Adapter {
  private config: S3Config;

  constructor(config: S3Config) {
    this.config = config;
  }

  async upload(
    key: string,
    buffer: Buffer,
    contentType?: string
  ): Promise<S3UploadResult> {
    // Implementation will use AWS SDK v3
    // const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
    throw new Error("S3 adapter not yet implemented");
  }

  async download(key: string): Promise<Buffer> {
    // Implementation will use AWS SDK v3
    throw new Error("S3 adapter not yet implemented");
  }

  async delete(key: string): Promise<void> {
    // Implementation will use AWS SDK v3
    throw new Error("S3 adapter not yet implemented");
  }

  async exists(key: string): Promise<boolean> {
    // Implementation will use AWS SDK v3
    throw new Error("S3 adapter not yet implemented");
  }

  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    // Implementation will use AWS SDK v3 getSignedUrl
    throw new Error("S3 adapter not yet implemented");
  }

  generateKey(projectId: string, filename: string): string {
    const timestamp = Date.now();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    return `projects/${projectId}/${timestamp}_${safeName}`;
  }
}
