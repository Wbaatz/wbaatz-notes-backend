import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import type { Readable } from "stream";
import { Readable as NodeReadable } from "stream";
import * as fs from "fs";
import * as path from "path";

const isB2Configured = !!(
  (process.env.B2_ENDPOINT_URL || process.env.B2_ENDPOINT) &&
  process.env.B2_APPLICATION_KEY_ID &&
  process.env.B2_APPLICATION_KEY &&
  process.env.B2_BUCKET_NAME
);

function normalizeEndpoint(raw: string): string {
  if (!raw) throw new Error("B2_ENDPOINT is not set");
  return raw.startsWith("http") ? raw : `https://${raw}`;
}

function getS3Client(): S3Client {
  const endpoint = normalizeEndpoint(process.env.B2_ENDPOINT_URL || process.env.B2_ENDPOINT || "");
  return new S3Client({
    endpoint,
    region: "auto",
    forcePathStyle: false,
    credentials: {
      accessKeyId: process.env.B2_APPLICATION_KEY_ID!,
      secretAccessKey: process.env.B2_APPLICATION_KEY!,
    },
    requestChecksumCalculation: "WHEN_REQUIRED" as any,
    responseChecksumValidation: "WHEN_REQUIRED" as any,
  });
}

const BUCKET = () => {
  const b = process.env.B2_BUCKET_NAME;
  if (!b) throw new Error("B2_BUCKET_NAME is not set");
  return b;
};

// Minimal valid transparent 1x1 PNG for fallback
const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

// Minimal valid single page PDF for fallback
const MINIMAL_PDF = Buffer.from(
  "%PDF-1.4\n" +
  "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n" +
  "3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R/Resources<<>>/Contents 4 0 R>>endobj\n" +
  "4 0 obj<</Length 48>>stream\n" +
  "BT /F1 12 Tf 70 700 Td (Local Developer PDF Placeholder) Tj ET\n" +
  "endstream\n" +
  "endobj\n" +
  "xref\n" +
  "0 5\n" +
  "0000000000 65535 f\n" +
  "0000000009 00000 n\n" +
  "0000000048 00000 n\n" +
  "0000000097 00000 n\n" +
  "0000000192 00000 n\n" +
  "trailer<</Size 5/Root 1 0 R>>\n" +
  "startxref\n" +
  "291\n" +
  "%%EOF"
);

export class B2StorageService {
  async getUploadPresignedUrl(filename: string): Promise<{ uploadURL: string; objectKey: string }> {
    if (!isB2Configured) {
      const objectKey = `uploads/${randomUUID()}/${filename}`;
      return { uploadURL: `http://localhost:5000/api/storage/uploads`, objectKey };
    }
    const client = getS3Client();
    const objectKey = `uploads/${randomUUID()}/${filename}`;
    const command = new PutObjectCommand({
      Bucket: BUCKET(),
      Key: objectKey,
      ContentType: "application/pdf",
    });
    const uploadURL = await getSignedUrl(client, command, { expiresIn: 900 });
    return { uploadURL, objectKey };
  }

  async putObject(objectKey: string, buffer: Buffer, contentType = "application/pdf"): Promise<void> {
    if (!isB2Configured) {
      const filePath = path.join(process.cwd(), "local_storage", objectKey);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, buffer);
      return;
    }
    const client = getS3Client();
    await client.send(new PutObjectCommand({
      Bucket: BUCKET(),
      Key: objectKey,
      Body: buffer,
      ContentLength: buffer.length,
      ContentType: contentType,
    }));
  }

  async streamObject(objectKey: string): Promise<{ stream: Readable; contentType: string; contentLength?: number }> {
    if (!isB2Configured) {
      const filePath = path.join(process.cwd(), "local_storage", objectKey);
      
      if (fs.existsSync(filePath)) {
        const ext = path.extname(objectKey).toLowerCase();
        let contentType = "application/octet-stream";
        if (ext === ".pdf") contentType = "application/pdf";
        else if (ext === ".png") contentType = "image/png";
        else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
        
        return {
          stream: fs.createReadStream(filePath) as unknown as Readable,
          contentType,
          contentLength: fs.statSync(filePath).size,
        };
      }

      const ext = path.extname(objectKey).toLowerCase();
      if (ext === ".pdf") {
        return {
          stream: NodeReadable.from(MINIMAL_PDF) as unknown as Readable,
          contentType: "application/pdf",
          contentLength: MINIMAL_PDF.length,
        };
      } else if (ext === ".png" || ext === ".jpg" || ext === ".jpeg") {
        const contentType = ext === ".png" ? "image/png" : "image/jpeg";
        return {
          stream: NodeReadable.from(MINIMAL_PNG) as unknown as Readable,
          contentType,
          contentLength: MINIMAL_PNG.length,
        };
      }

      throw new Error(`Local file not found: ${objectKey}`);
    }

    const client = getS3Client();
    const command = new GetObjectCommand({ Bucket: BUCKET(), Key: objectKey });
    const response = await client.send(command);
    if (!response.Body) throw new Error("Empty response from B2");
    return {
      stream: response.Body as unknown as Readable,
      contentType: response.ContentType || "application/pdf",
      contentLength: response.ContentLength,
    };
  }

  async objectExists(objectKey: string): Promise<boolean> {
    if (!isB2Configured) {
      const filePath = path.join(process.cwd(), "local_storage", objectKey);
      if (fs.existsSync(filePath)) return true;
      const ext = path.extname(objectKey).toLowerCase();
      return ext === ".pdf" || ext === ".png" || ext === ".jpg" || ext === ".jpeg";
    }

    try {
      const client = getS3Client();
      await client.send(new HeadObjectCommand({ Bucket: BUCKET(), Key: objectKey }));
      return true;
    } catch {
      return false;
    }
  }
}

export const b2 = new B2StorageService();
