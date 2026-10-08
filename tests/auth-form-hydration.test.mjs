import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

/** Render the real auth components with server hooks, before effects/hydration. */
function serverHtml(path, {signinMfa = false, resetStage} = {}) {
  let stateIndex = 0;
  const react = {...React, useState(initial) {
    const index = stateIndex++;
    if (signinMfa && index === 6) initial = true;
    if (signinMfa && index === 8) initial = '123456';
    if (resetStage && initial === 'verifying-link') initial = resetStage;
    return React.useState(initial);
  }};
  const overrides = {
    react, 'react/jsx-runtime': jsxRuntime,
    'next/link': {__esModule: true, default: ({children, ...props}) => React.createElement('a', props, children)},
    '@/components/site-header': {SiteHeader: () => null}, '@/components/site-footer': {SiteFooter: () => null},
    '@/lib/supabase/client': {createClient: () => ({auth: {}})},
  };
  function load(file) {
    const exports = {};
    const compiled = ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
    }).outputText;
    new Function('require', 'exports', compiled)(name => {
      if (name in overrides) return overrides[name];
      assert.ok(name.startsWith('@/lib/'), name); return load(name.slice(2) + '.ts');
    }, exports);
    return exports;
  }
  return renderToStaticMarkup(React.createElement(load(path).default));
}

test('server-rendered signup/sign-in/reset requests cannot submit credentials through native GET', () => {
  const cases = [
    ['app/sign-up/page.tsx', {}, 'Start Free Trial'],
    ['app/sign-in/page.tsx', {}, 'Sign In'],
    ['app/sign-in/page.tsx', {signinMfa: true}, 'Two-factor authentication'],
    ['app/forgot-password/page.tsx', {}, 'Send Reset Link'],
    ['app/reset-password/page.tsx', {resetStage: 'password'}, 'Update password'],
    ['app/reset-password/page.tsx', {resetStage: 'mfa'}, 'Verify and continue'],
  ];
  for (const [path, options, expected] of cases) {
    const html = serverHtml(path, options);
    assert.ok(html.includes(expected), path);
    const forms = [...html.matchAll(/<form\b[^>]*>/g)].map(match => match[0]);
    assert.ok(forms.length > 0, path);
    for (const form of forms) assert.match(form, /method="post"/, path);
    const submits = [...html.matchAll(/<button\b[^>]*type="submit"[^>]*>/g)].map(match => match[0]);
    assert.ok(submits.length > 0, path);
    for (const submit of submits) assert.match(submit, /disabled=""/, path);
    assert.match(html, /<noscript>.*Enable JavaScript and reload this page/s, path);
  }
});

test('password recovery waiting on a link provides a no-JavaScript recovery message', () => {
  const html = serverHtml('app/reset-password/page.tsx');
  assert.match(html, /Verifying your reset link/);
  assert.match(html, /<noscript>.*Enable JavaScript and reload this page/s);
});
