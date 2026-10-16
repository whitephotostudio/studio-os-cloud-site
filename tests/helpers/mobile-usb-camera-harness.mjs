import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(
  fs.readFileSync(new URL("../../lib/mobile-usb-camera.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

export function loadMobileUsbCamera({ platform = "ios", available = true, plugin = {}, ...globals } = {}) {
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Blob, Uint8Array, atob, URL, Date,
    require: name => {
      if (name !== "@capacitor/core") throw new Error(`Unexpected import ${name}`);
      return {
        Capacitor: { getPlatform: () => platform, isPluginAvailable: () => available },
        registerPlugin: name => {
          if (name !== "StudioOSCamera") throw new Error("Wrong native plugin");
          return plugin;
        },
      };
    },
    ...globals,
  });
  return exports;
}

export function usbPhotoFixture(size = 8) {
  const bytes = new Uint8Array(size);
  bytes.set([255, 216]);
  bytes.set([255, 217], size - 2);
  const photo = { id: "native-photo-1", name: "IMG_0001.JPG", size, mimeType: "image/jpeg" };
  const reads = [], acknowledgements = [];
  const camera = {
    async readPhoto(request) {
      if (!request.ownerId) throw new Error("Native read requires its account");
      reads.push(request);
      const end = request.offset + request.length;
      return { data: Buffer.from(bytes.subarray(request.offset, end)).toString("base64"), done: end === bytes.length };
    },
    async acknowledgePhoto(request) {
      if (!request.ownerId) throw new Error("Native acknowledgement requires its account");
      acknowledgements.push(request);
    },
  };
  return { bytes, photo, camera, reads, acknowledgements };
}
