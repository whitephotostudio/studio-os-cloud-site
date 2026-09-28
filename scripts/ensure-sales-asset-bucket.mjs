#!/usr/bin/env node
// Run with: node --env-file=.env.local scripts/ensure-sales-asset-bucket.mjs
// This creates only the private bucket. App routes issue owner-checked,
// short-lived signed URLs; no broad storage.objects policy is added.
import { createClient } from "@supabase/supabase-js";

const id = "sales-document-assets";
const maxBytes = 100 * 1024 * 1024;
const mimeTypes = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: buckets, error: listError } = await supabase.storage.listBuckets();
if (listError) throw listError;
let bucket = (buckets ?? []).find((item) => item.id === id);
if (!bucket) {
  const { error } = await supabase.storage.createBucket(id, {
    public: false,
    fileSizeLimit: maxBytes,
    allowedMimeTypes: mimeTypes,
  });
  if (error) throw error;
  const { data, error: checkError } = await supabase.storage.getBucket(id);
  if (checkError) throw checkError;
  bucket = data;
  console.log(`Created private ${id} bucket.`);
} else {
  console.log(`${id} bucket already exists.`);
}

const allowed = new Set(bucket.allowed_mime_types ?? []);
if (bucket.public ||
    (bucket.file_size_limit ?? 0) < maxBytes ||
    mimeTypes.some((type) => !allowed.has(type))) {
  throw new Error(`${id} exists but is not private with the required file limit and MIME types.`);
}
console.log(`${id}: private, 100 MB limit, PDF/image MIME types verified.`);
