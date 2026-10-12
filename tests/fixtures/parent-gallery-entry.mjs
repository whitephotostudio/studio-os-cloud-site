import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

/** Real entry encryption/normalization and trusted origin, synthetic configuration. */
export function parentGalleryEntryFixture() {
  const dependencies = {
    'server-only': {},
    'node:crypto': crypto,
  };
  const load = file => {
    const exports = {};
    const compiled = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(compiled, {
      exports, Buffer, URL, URLSearchParams, Date,
      process: { env: { DOWNLOAD_TOKEN_SECRET: 'synthetic-parent-entry-fixture-signing-secret', NEXT_PUBLIC_SITE_URL: 'https://gallery.example.test' } },
      require(name) {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected entry fixture dependency: ${name}`);
        return dependencies[name];
      },
      fetch: () => assert.fail('Entry fixtures must never contact a provider'),
    }, { filename: file });
    return exports;
  };
  dependencies['@/lib/encrypted-capability'] = load('lib/encrypted-capability.ts');
  return { ...load('lib/parent-gallery-entry.ts'), pinRecoveryOrigin: load('lib/pin-recovery.ts').pinRecoveryOrigin };
}
