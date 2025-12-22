import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

@Injectable()
export class R2StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.get<string>('S3_API');
    const accessKeyId = this.config.get<string>('CLOUDFARE_ACCESS_KEY');
    const secretAccessKey = this.config.get<string>('CLOUDFARE_SECRET_ACCESS_KEY');
    const bucket = this.config.get<string>('R2_BUCKET_NAME');

    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error('Missing Cloudflare R2 configuration.');
    }

    this.bucket = bucket;
    this.client = new S3Client({
      region: 'auto',
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });
  }

  async uploadBuffer(params: { key: string; body: Buffer; contentType?: string }): Promise<{ eTag?: string }> {
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType
      })
    );

    return { eTag: result.ETag };
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      })
    );

    const body = result.Body;
    if (!body) {
      throw new Error('Empty object body.');
    }

    if (Buffer.isBuffer(body)) {
      return body;
    }

    if (body instanceof Uint8Array) {
      return Buffer.from(body);
    }

    const stream = body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
    }
    return Buffer.concat(chunks);
  }
}
