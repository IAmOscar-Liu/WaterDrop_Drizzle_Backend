import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import fs from "node:fs";
import mime from "mime";

const accountId = process.env.R2_ACCOUNT_ID!;
const bucketName = process.env.R2_BUCKET!;
const accessKeyId = process.env.R2_ACCESS_KEY_ID!;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY!;

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
});

export async function uploadFile({
  localPath,
  key,
}: {
  localPath: string;
  key: string;
}) {
  const Body = fs.createReadStream(localPath);
  const ContentType = mime.getType(localPath) || "application/octet-stream";
  console.log(localPath);

  // Multipart when needed (large files), otherwise PutObjectCommand also works.
  const up = new Upload({
    client: s3,
    params: {
      Bucket: bucketName,
      Key: key,
      Body,
      ContentType,
      CacheControl: "public, max-age=31536000, immutable",
    },
  });
  await up.done();
  console.log("Uploaded:", `${process.env.R2_PUBLIC_URL}/${key}`);

  return `${process.env.R2_PUBLIC_URL}/${key}`;
}
