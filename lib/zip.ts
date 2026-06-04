export type ZipEntry = {
  name: string;
  data: Uint8Array;
  modifiedAt?: Date;
};

export type ZipStreamEntry = {
  name: string;
  data?: Uint8Array;
  stream?: ReadableStream<Uint8Array>;
  modifiedAt?: Date;
};

const ZIP_UTF8_FLAG = 0x0800;
const ZIP_DATA_DESCRIPTOR_FLAG = 0x0008;
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
  return (crc32Update(0xffffffff, bytes) ^ 0xffffffff) >>> 0;
}

function crc32Update(crc: number, bytes: Uint8Array) {
  const table = getCrcTable();
  for (let index = 0; index < bytes.length; index += 1) {
    crc = table[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
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

function normalizeEntryData(entry: ZipStreamEntry) {
  if (entry.data) return entry.data;
  return null;
}

type ZipStreamState = {
  offset: number;
  centralParts: Uint8Array[];
  entryCount: number;
};

async function* streamZipEntry(
  entry: ZipStreamEntry,
  state: ZipStreamState,
): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  const entryName = sanitizeEntryName(entry.name);
  const fileNameBytes = encoder.encode(entryName);
  const { dosTime, dosDate } = toDosDateParts(entry.modifiedAt);
  const localOffset = state.offset;
  const generalPurposeFlags = ZIP_UTF8_FLAG | ZIP_DATA_DESCRIPTOR_FLAG;

  const track = (chunk: Uint8Array) => {
    state.offset += chunk.length;
    return chunk;
  };

  yield track(
    concatBytes([
      uint32(0x04034b50),
      uint16(20),
      uint16(generalPurposeFlags),
      uint16(0),
      uint16(dosTime),
      uint16(dosDate),
      uint32(0),
      uint32(0),
      uint32(0),
      uint16(fileNameBytes.length),
      uint16(0),
      fileNameBytes,
    ]),
  );

  let checksum = 0xffffffff;
  let fileSize = 0;
  const staticData = normalizeEntryData(entry);
  if (staticData) {
    checksum = crc32Update(checksum, staticData);
    fileSize += staticData.length;
    yield track(staticData);
  } else if (entry.stream) {
    const reader = entry.stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        checksum = crc32Update(checksum, value);
        fileSize += value.length;
        yield track(value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  const finalizedChecksum = (checksum ^ 0xffffffff) >>> 0;
  yield track(
    concatBytes([
      uint32(0x08074b50),
      uint32(finalizedChecksum),
      uint32(fileSize),
      uint32(fileSize),
    ]),
  );

  state.centralParts.push(
    concatBytes([
      uint32(0x02014b50),
      uint16(20),
      uint16(20),
      uint16(generalPurposeFlags),
      uint16(0),
      uint16(dosTime),
      uint16(dosDate),
      uint32(finalizedChecksum),
      uint32(fileSize),
      uint32(fileSize),
      uint16(fileNameBytes.length),
      uint16(0),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(0),
      uint32(localOffset),
      fileNameBytes,
    ]),
  );
  state.entryCount += 1;
}

async function* streamZipChunks(
  entries: AsyncIterable<ZipStreamEntry> | Iterable<ZipStreamEntry>,
) {
  const state: ZipStreamState = {
    offset: 0,
    centralParts: [],
    entryCount: 0,
  };

  for await (const entry of entries) {
    yield* streamZipEntry(entry, state);
  }

  const centralDirectory = concatBytes(state.centralParts);
  const centralDirectoryOffset = state.offset;
  state.offset += centralDirectory.length;
  yield centralDirectory;

  yield concatBytes([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(state.entryCount),
    uint16(state.entryCount),
    uint32(centralDirectory.length),
    uint32(centralDirectoryOffset),
    uint16(0),
  ]);
}

export function createZipStream(
  entries: AsyncIterable<ZipStreamEntry> | Iterable<ZipStreamEntry>,
) {
  const iterator = streamZipChunks(entries)[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}
