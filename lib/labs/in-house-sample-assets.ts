import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { InHouseTestAsset } from "./in-house-orders-types";

export const IN_HOUSE_SAMPLE_PHOTO_ID = "studio-os-inhouse-demo-v1" as const;
const assets: readonly InHouseTestAsset[] = [
  { id: "sample-8x10", filename: "studio-os-inhouse-sample-8x10.jpg", widthInches: 8, heightInches: 10,
    widthPixels: 2400, heightPixels: 3000, sha256: "fa65a553f0ae9c1e61fbdb93f80248e040ce710bc4952c13730f653b850705e9", byteSize: 257322, quantity: 1 },
  { id: "sample-5x7", filename: "studio-os-inhouse-sample-5x7.jpg", widthInches: 5, heightInches: 7,
    widthPixels: 1500, heightPixels: 2100, sha256: "7eec98c86211afce376024290609e91d55942d4cfeee8a9b6ba2a386cd54a5f0", byteSize: 156810, quantity: 2 },
];

/** Fixed synthetic artwork only. No customer file, arbitrary path or upload is accepted. */
export async function readInHouseSampleAsset(id: string) {
  const asset = assets.find(value => value.id === id);
  if (!asset) throw new Error("Choose one of the two in-house sample print files.");
  const bytes = await readFile(join(process.cwd(), "tests/helpers", asset.filename));
  if (bytes.byteLength !== asset.byteSize || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
    throw new Error("The fixed sample print file differs from its verified manifest.");
  }
  return { asset: { ...asset }, bytes };
}

export async function inHouseSampleAssets(): Promise<InHouseTestAsset[]> {
  const files = await Promise.all(assets.map(asset => readInHouseSampleAsset(asset.id)));
  return files.map(file => file.asset);
}
