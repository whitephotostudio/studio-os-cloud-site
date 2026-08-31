import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const settingsSource = source("app/dashboard/settings/page.tsx");
const packageJson = JSON.parse(source("package.json"));

test("MFA enrollment renders its TOTP QR code locally", () => {
  assert.match(settingsSource, /import \{ QRCodeSVG \} from ["']qrcode\.react["']/);
  assert.match(settingsSource, /<QRCodeSVG[\s\S]*value=\{enrollQrUri\}/);
  assert.doesNotMatch(settingsSource, /api\.qrserver\.com/i);
  assert.equal(typeof packageJson.dependencies?.["qrcode.react"], "string");
});
