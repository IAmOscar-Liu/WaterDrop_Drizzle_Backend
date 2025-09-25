import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import fs from "node:fs";
import mime from "mime";

const accountId = process.env.R2_ACCOUNT_ID!;
const bucket = process.env.R2_BUCKET!;
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true,
});

export async function uploadFile(localPath: string, key: string) {
  const Body = fs.createReadStream(localPath);
  const ContentType = mime.getType(localPath) || "application/octet-stream";
  console.log(localPath);

  // Multipart when needed (large files), otherwise PutObjectCommand also works.
  const up = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body,
      ContentType,
      CacheControl: "public, max-age=31536000, immutable",
    },
  });
  await up.done();
  console.log(
    "Uploaded:",
    `https://pub-c796d4f72aca45d68562ea9d55d46e5e.r2.dev/${key}`
  );

  return `https://pub-c796d4f72aca45d68562ea9d55d46e5e.r2.dev/${key}`;
}
