import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import crypto from "node:crypto";
import zlib from "node:zlib";
import sharp from "sharp";
const code = ts.transpileModule(
  fs.readFileSync(
    new URL("../lib/order-automation-zip.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  },
).outputText;
const exports = {};
new Function("require", "exports", code)(
  (name) =>
    ({
      "node:zlib": zlib,
      sharp: sharp,
      "@/lib/order-automation-storage": {
        digest: (b) => crypto.createHash("sha256").update(b).digest("hex"),
      },
    })[name],
  exports,
);
function zip(entries) {
  const body = [],
    directory = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name),
      local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt32LE(exports.zipCrc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    body.push(local, n, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt32LE(exports.zipCrc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(directory),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...body, dir, end]);
}
test("ZIP parser rejects traversal, duplicate names and unbounded expansion", () => {
  for (const entries of [
    [
      ["../escape", Buffer.alloc(1)],
      ["a", Buffer.alloc(1)],
      ["b", Buffer.alloc(1)],
    ],
    [
      ["a", Buffer.alloc(1)],
      ["a", Buffer.alloc(1)],
      ["b", Buffer.alloc(1)],
    ],
  ])
    assert.throws(() => exports.readNoritsuZip(zip(entries)));
  const b = zip([
    ["a", Buffer.alloc(1)],
    ["b", Buffer.alloc(1)],
    ["c", Buffer.alloc(1)],
  ]);
  const offset = b.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  b.writeUInt32LE(65 * 1024 * 1024, offset + 24);
  assert.throws(() => exports.readNoritsuZip(b));
});
test("a ZIP with changed bytes cannot reach a lab even if its lengths match", () => {
  const b = zip([
    ["a", Buffer.from("a")],
    ["b", Buffer.from("b")],
    ["c", Buffer.from("c")],
  ]);
  b[31] = 99;
  assert.throws(() => exports.readNoritsuZip(b), /checksum/);
});
test("server verifies actual sheet JPEG hashes, purchased quantities and physical geometry", async () => {
  const jpeg = await sharp({
    create: { width: 300, height: 420, channels: 3, background: "#778899" },
  })
    .withMetadata({ density: 300 })
    .jpeg()
    .toBuffer();
  const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
  const m = {
    schemaVersion: 1,
    ownerId: "owner",
    printPieceCount: 1,
    purchases: [
      {
        ownerId: "owner",
        orderId: "order",
        productQuantity: 1,
        printsPerUnit: 1,
        renderSha256: hash(jpeg),
      },
    ],
    sheets: [
      {
        path: "school/order/item/1.jpg",
        sha256: hash(jpeg),
        sheet: { dpi: 300, pixelWidth: 300, pixelHeight: 420 },
        slots: [
          {
            ownerId: "owner",
            orderId: "order",
            x: 0,
            y: 0,
            width: 300,
            height: 420,
          },
        ],
      },
    ],
  };
  const archive = () =>
    zip([
      ["school/order/manifest.json", Buffer.from(JSON.stringify(m))],
      ["school/order/prints.csv", Buffer.from("csv")],
      ["school/order/item/1.jpg", jpeg],
    ]);
  assert.deepEqual(
    await exports.verifyNoritsuZip(archive(), "owner", ["order"]),
    { pieces: 1, orders: 1 },
  );
  // Current Flutter NoritsuPrintSlot.toJson() puts all coordinates in this
  // object; a flat-only fixture previously hid the desktop/server mismatch.
  const rectangle = { x: 0, y: 0, width: 300, height: 420 };
  const slot = {
    ownerId: "owner", orderId: "order", itemId: "item",
    productUnitNumber: 1, printWithinUnit: 1, quarterTurns: 0,
    rectanglePixels: rectangle,
  };
  m.sheets[0].slots = [slot];
  assert.deepEqual(await exports.verifyNoritsuZip(archive(), "owner", ["order"]),
    { pieces: 1, orders: 1 });
  for (const invalid of [null, [], {}, { ...rectangle, x: -1 },
    { ...rectangle, y: .5 }, { ...rectangle, width: 301 },
    { ...rectangle, height: 0 }, { ...rectangle, x: Number.MAX_SAFE_INTEGER + 1 }]) {
    slot.rectanglePixels = invalid;
    await assert.rejects(exports.verifyNoritsuZip(archive(), "owner", ["order"]), /rectangle/);
  }
  slot.rectanglePixels = rectangle;
  slot.x = 0;
  await assert.rejects(exports.verifyNoritsuZip(archive(), "owner", ["order"]), /rectangle/);
  delete slot.x;
  slot.ownerId = "another-studio";
  await assert.rejects(exports.verifyNoritsuZip(archive(), "owner", ["order"]), /rectangle/);
  slot.ownerId = "owner";
  // Eight purchased wallets are eight correctly bounded physical print slots.
  m.sheets[0].slots = Array.from({length: 8}, (_, index) => ({...slot,
    printWithinUnit: index + 1,
    rectanglePixels: { x: (index % 2) * 150, y: Math.floor(index / 2) * 105, width: 150, height: 105 },
  }));
  m.purchases[0].printsPerUnit = 8;
  m.printPieceCount = 8;
  assert.deepEqual(await exports.verifyNoritsuZip(archive(), "owner", ["order"]),
    {pieces: 8, orders: 1});
  m.sheets[0].slots = [slot];
  m.purchases[0].printsPerUnit = 1;
  m.printPieceCount = 1;
  m.sheets[0].sha256 = "0".repeat(64);
  await assert.rejects(exports.verifyNoritsuZip(archive(), "owner", ["order"]));
  m.sheets[0].sha256 = hash(jpeg);
  m.purchases[0].productQuantity = 2;
  await assert.rejects(exports.verifyNoritsuZip(archive(), "owner", ["order"]));
  m.purchases[0].productQuantity = 1;
  m.sheets[0].sheet.pixelWidth = 301;
  await assert.rejects(exports.verifyNoritsuZip(archive(), "owner", ["order"]));
});
