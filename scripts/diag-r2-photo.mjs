// Broad R2 audit — what photos ACTUALLY exist in storage vs. what the DB
// claims should be there?
//
// Usage:
//   cd ~/Projects/studio-os-cloud-site
//   env $(grep -v '^#' .env.local | xargs) node scripts/diag-r2-photo.mjs

import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET_NAME || "whitephoto-media";

const client = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

async function listPrefix(prefix, label) {
  console.log(`\n=== ${label} ===`);
  console.log(`prefix: "${prefix}"`);
  let totalCount = 0;
  let totalBytes = 0;
  let token;
  let firstFew = [];
  do {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of result.Contents ?? []) {
      totalCount += 1;
      totalBytes += obj.Size ?? 0;
      if (firstFew.length < 5) {
        firstFew.push(`   - ${obj.Key} (${obj.Size} bytes, ${obj.LastModified?.toISOString()})`);
      }
    }
    token = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (token);
  console.log(`Found ${totalCount} keys, total ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
  if (firstFew.length > 0) {
    console.log("First few:");
    firstFew.forEach((line) => console.log(line));
  }
  return { count: totalCount, bytes: totalBytes };
}

console.log(`\nAuditing R2 bucket "${R2_BUCKET}" with new credentials...\n`);

// Top-level: what kinds of folders exist at all?
const top = await listPrefix("", "Top-level (everything in bucket)");

// Specific projects we know about
await listPrefix(
  "projects/0f201afa-83ce-45c9-a2f6-d7621a09ee01/",
  "New Project (139 DB rows expected)",
);
await listPrefix(
  "projects/99a01f64-d406-46ea-b605-5c01c8e4792e/",
  "MONTE BAPTISM (316 DB rows expected)",
);

// Old school-mode uploads
await listPrefix("ed6b8a99-1f38-48f3-a198-447c49b5ac34/", "Photographer-id-prefixed school photos");

console.log(`\n=== Summary ===`);
console.log(`Total objects in bucket: ${top.count}`);
console.log(`If New Project & MONTE BAPTISM both show 0 keys → desktop hasn't uploaded ANY photos to R2 for a while.`);
console.log(`If MONTE BAPTISM has photos but New Project doesn't → only recent uploads are missing (token revoked).`);
console.log(`If both have photos → photos exist but at different paths than DB expects.\n`);
