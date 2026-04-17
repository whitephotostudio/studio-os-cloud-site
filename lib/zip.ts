export type ZipEntry = {
  name: string;
  data: Uint8Array;
  modifiedAt?: Date;
};

const ZIP_UTF8_FLAG = 0x0800;
const DOS_EPOCH_YEAR = 1980;

let crcTable: Uint32Array | null = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[index] = crc >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  const table = getCrcTable();
  for (let index = 0; index < bytes.length; index += 1) {
    crc = table[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateParts(input?: Date) {
  const date = input ?? new Date();
  const year = Math.max(DOS_EPOCH_YEAR, date.getFullYear());
  const month = Math.max(1, date.getMonth() + 1);
  const day = Math.max(1, date.getDate());
  const hours = Math.max(0, date.getHours());
  const minutes = Math.max(0, date.getMinutes());
  const seconds = Math.floor(Math.max(0, date.getSeconds()) / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - DOS_EPOCH_YEAR) << 9) | (month << 5) | day;

  return { dosTime, dosDate };
}

function uint16(value: number) {
  const bytes = new Uint8Array(2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, value, true);
  return bytes;
}

function uint32(value: number) {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, value >>> 0, true);
  return bytes;
}

function concatBytes(chunks: Uint8Array[]) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function sanitizeEntryName(name: string) {
  const normalized = name
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
  return normalized || "download";
}

export function createZipBytes(entries: ZipEntry[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const entryName = sanitizeEntryName(entry.name);
    const fileNameBytes = encoder.encode(entryName);
    const fileBytes = entry.data;
    const checksum = crc32(fileBytes);
    const { dosTime, dosDate } = toDosDateParts(entry.modifiedAt);

    const localHeader = concatBytes([
      uint32(0x04034b50),
      uint16(20),
      uint16(ZIP_UTF8_FLAG),
      uint16(0),
      uint16(dosTime),
      uint16(dosDate),
      uint32(checksum),
      uint32(fileBytes.length),
      uint32(fileBytes.length),
      uint16(fileNameBytes.length),
      uint16(0),
      fileNameBytes,
    ]);

    localParts.push(localHeader, fileBytes);

    const centralHeader = concatBytes([
      uint32(0x02014b50),
      uint16(20),
      uint16(20),
      uint16(ZIP_UTF8_FLAG),
      uint16(0),
      uint16(dosTime),
      uint16(dosDate),
      uint32(checksum),
      uint32(fileBytes.length),
      uint32(fileBytes.length),
      uint16(fileNameBytes.length),
      uint16(0),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(0),
      uint32(localOffset),
      fileNameBytes,
    ]);

    centralParts.push(centralHeader);
    localOffset += localHeader.length + fileBytes.length;
  }

  const centralDirectory = concatBytes(centralParts);
  const localDirectory = concatBytes(localParts);

  const endRecord = concatBytes([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(entries.length),
    uint16(entries.length),
    uint32(centralDirectory.length),
    uint32(localDirectory.length),
    uint16(0),
  ]);

  return concatBytes([localDirectory, centralDirectory, endRecord]);
}

export function createZipBlob(entries: ZipEntry[]) {
  return new Blob([createZipBytes(entries)], {
    type: "application/zip",
  });
}
