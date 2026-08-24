import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const directLoginForm = readFileSync(
  new URL("../app/parents/SchoolDirectLoginForm.tsx", import.meta.url),
  "utf8",
);

test("direct school login keeps typed email and PIN text dark in system dark mode", () => {
  const inputStyle = directLoginForm.slice(
    directLoginForm.indexOf("const inputStyle"),
  );

  assert.match(inputStyle, /background: "#fff"/);
  assert.match(inputStyle, /color: "#111827"/);
  assert.match(inputStyle, /caretColor: "#111827"/);
  assert.match(inputStyle, /colorScheme: "light"/);
});
