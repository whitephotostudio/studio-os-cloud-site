import { inflateRawSync } from "node:zlib";
import { digest } from "@/lib/order-automation-storage";
import sharp from "sharp";
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++)
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});
export function zipCrc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
/** Read central-directory entries only. Bound expansion before inflating; reject
 * encrypted, duplicate, traversal, ZIP64 and unsupported archives. */
export function readNoritsuZip(bytes: Buffer) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (
    end < 0 ||
    end + 22 > bytes.length ||
    end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length ||
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0
  )
    throw Error("Invalid Noritsu ZIP.");
  const count = bytes.readUInt16LE(end + 10),
    size = bytes.readUInt32LE(end + 12),
    start = bytes.readUInt32LE(end + 16);
  if (count < 3 || count > 10000 || start + size !== end)
    throw Error("ZIP directory exceeds the lab limit.");
  const files = new Map<string, Buffer>();
  let offset = start,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw Error("Invalid ZIP directory.");
    const flags = bytes.readUInt16LE(offset + 8),
      method = bytes.readUInt16LE(offset + 10),
      compressed = bytes.readUInt32LE(offset + 20),
      expanded = bytes.readUInt32LE(offset + 24),
      length = bytes.readUInt16LE(offset + 28),
      extra = bytes.readUInt16LE(offset + 30),
      comment = bytes.readUInt16LE(offset + 32),
      local = bytes.readUInt32LE(offset + 42);
    const name = bytes
      .subarray(offset + 46, offset + 46 + length)
      .toString("utf8");
    offset += 46 + length + extra + comment;
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      !name ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").some((s) => !s || s === "." || s === "..") ||
      /[\x00-\x1f\x7f]/.test(name) ||
      files.has(name) ||
      expanded > 64 * 1024 * 1024 ||
      (total += expanded) > 512 * 1024 * 1024
    )
      throw Error("Unsafe or oversized lab ZIP.");
    if (local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50)
      throw Error("Invalid ZIP entry.");
    const dataStart =
      local +
      30 +
      bytes.readUInt16LE(local + 26) +
      bytes.readUInt16LE(local + 28);
    const localName = bytes
      .subarray(local + 30, local + 30 + bytes.readUInt16LE(local + 26))
      .toString("utf8");
    if (
      localName !== name ||
      dataStart + compressed > start ||
      bytes.readUInt16LE(local + 8) !== method ||
      bytes.readUInt16LE(local + 6) !== flags
    )
      throw Error("ZIP entry path mismatch.");
    const data =
      method === 8
        ? inflateRawSync(bytes.subarray(dataStart, dataStart + compressed), {
            maxOutputLength: Math.max(1, expanded),
          })
        : bytes.subarray(dataStart, dataStart + compressed);
    if (data.length !== expanded) throw Error("ZIP entry length mismatch.");
    if (
      zipCrc32(data) !==
      bytes.readUInt32LE(offset - 46 - length - extra - comment + 16)
    )
      throw Error("ZIP checksum mismatch.");
    files.set(name, data);
  }
  if (offset !== end) throw Error("Unexpected ZIP entries.");
  return files;
}
export async function verifyNoritsuZip(
  bytes: Buffer,
  owner: string,
  localOrders: string[],
) {
  const files = readNoritsuZip(bytes);
  const manifests = [...files].filter(([name]) =>
    name.endsWith("/manifest.json"),
  );
  if (manifests.length !== localOrders.length)
    throw Error("Lab manifests do not cover exactly these orders.");
  const found = new Set<string>(),
    sheets = new Set<string>();
  let pieces = 0;
  for (const [name, data] of manifests) {
    if (data.length > 1024 * 1024) throw Error("Manifest is too large.");
    const m = JSON.parse(data.toString());
    const parts = name.split("/");
    const orderId = parts.at(-2)!;
    if (
      m.schemaVersion !== 1 ||
      m.ownerId !== owner ||
      !localOrders.includes(orderId) ||
      found.has(orderId) ||
      !Array.isArray(m.purchases) ||
      !Array.isArray(m.sheets) ||
      !Number.isSafeInteger(m.printPieceCount) ||
      m.printPieceCount < 1
    )
      throw Error("Noritsu purchase manifest mismatch.");
    found.add(orderId);
    let actualPieces = 0;
    for (const purchase of m.purchases) {
      if (
        purchase.ownerId !== owner ||
        purchase.orderId !== orderId ||
        !Number.isSafeInteger(purchase.productQuantity) ||
        purchase.productQuantity < 1 ||
        ![1, 8].includes(purchase.printsPerUnit) ||
        !/^[a-f0-9]{64}$/.test(purchase.renderSha256 || "")
      )
        throw Error("Invalid purchased print.");
    }
    for (const sheet of m.sheets) {
      if (
        typeof sheet.path !== "string" ||
        !sheet.path.startsWith(parts.slice(0, -1).join("/") + "/") ||
        sheets.has(sheet.path) ||
        !Array.isArray(sheet.slots)
      )
        throw Error("Invalid Noritsu sheet path.");
      const image = files.get(sheet.path);
      if (!image || digest(image) !== sheet.sha256)
        throw Error("Noritsu sheet hash mismatch.");
      const spec = sheet.sheet;
      const info = await sharp(image, {
        limitInputPixels: 64 * 1000 * 1000,
      }).metadata();
      if (
        info.format !== "jpeg" ||
        info.hasAlpha ||
        info.density !== 300 ||
        (info.orientation && info.orientation !== 1) ||
        !spec ||
        spec.dpi !== 300 ||
        info.width !== spec.pixelWidth ||
        info.height !== spec.pixelHeight
      )
        throw Error("Noritsu sheet pixels or DPI are invalid.");
      for (const slot of sheet.slots) {
        if (
          slot.ownerId !== owner ||
          slot.orderId !== orderId ||
          !Number.isSafeInteger(slot.x) ||
          !Number.isSafeInteger(slot.y) ||
          !Number.isInteger(slot.width) ||
          !Number.isInteger(slot.height) ||
          slot.x < 0 ||
          slot.y < 0 ||
          slot.width < 1 ||
          slot.height < 1 ||
          slot.x + slot.width > info.width! ||
          slot.y + slot.height > info.height!
        )
          throw Error("Invalid Noritsu print rectangle.");
        actualPieces++;
      }
      sheets.add(sheet.path);
    }
    const purchasedPieces = m.purchases.reduce(
      (sum: number, p: { productQuantity: number; printsPerUnit: number }) =>
        sum + p.productQuantity * p.printsPerUnit,
      0,
    );
    if (actualPieces !== m.printPieceCount || actualPieces !== purchasedPieces)
      throw Error("Noritsu print quantities do not match purchases.");
    pieces += actualPieces;
  }
  if (
    [...files.keys()].some(
      (name) =>
        !sheets.has(name) &&
        !name.endsWith("/manifest.json") &&
        !name.endsWith("/prints.csv") &&
        name !== "lab-email-draft.txt",
    )
  )
    throw Error("Unexpected file in lab batch.");
  return { pieces, orders: found.size };
}
