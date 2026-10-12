import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { parentGalleryEntryFixture } from '../fixtures/parent-gallery-entry.mjs';

const source = readFileSync(new URL('../../components/parents/parent-gallery-client.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('parent-gallery-client.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handlerSource(name) {
  let result;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(result, `Actual gallery handler ${name} must exist`);
  return result;
}
const compiled = ts.transpileModule([
  handlerSource('getPhotoReference'), handlerSource('handleShareGallery'), handlerSource('handleShareImage'),
  'return { handleShareGallery, handleShareImage };',
].join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const instantiate = new Function('sessionAccess', 'currentGalleryExtras', 'galleryHeaderTitle', 'galleryHeadline',
  'window', 'clean', 'showGalleryActionNotice', 'galleryCopy', 'copyShareTextToClipboard', 'DOMException', 'fetch', compiled);
const origin = 'https://gallery.example.test';
const currentUrl = `${origin}/parents/view/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?checkout=success&return=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb&session_id=cs_private_browser_return`;
const credentials = { kind: 'school', galleryId: '11111111-1111-4111-8111-111111111111',
  photographerId: '22222222-2222-4222-8222-222222222222', pin: 'synthetic-school-pin', email: 'viewer@example.test' };

function fixture({ sessionAccess = null, enabled = true, share = true, href = currentUrl, shareError = null } = {}) {
  const events = [], copies = [], notices = [];
  const navigator = share ? { share(payload) {
    events.push(payload);
    return shareError ? Promise.reject(shareError) : Promise.resolve();
  } } : {};
  const handlers = instantiate(sessionAccess, { allowSocialSharing: enabled, socialShareMessage: '' }, 'Gallery title', 'Gallery fallback',
    { location: { origin, href }, navigator }, value => String(value ?? '').trim(), value => notices.push(value),
    { shareSheetOpened: 'Share opened', galleryLinkCopied: 'Gallery copied' }, async value => { copies.push(value); }, DOMException,
    () => assert.fail('Sharing must preserve browser user activation without a network request'));
  return { ...handlers, events, copies, notices };
}
const image = { id: 'photo', filename: 'Synthetic-photo.jpg' };
for (const name of ['handleShareGallery', 'handleShareImage']) {
  test(`${name} sends the actual encrypted entry URL synchronously, with no private return or credential selectors`, async () => {
    const entry = parentGalleryEntryFixture();
    const shareUrl = entry.createParentGalleryEntryPath(credentials);
    const f = fixture({ sessionAccess: { shareUrl } });
    const pending = f[name](image, 2);
    assert.equal(f.events.length, 1, 'Web Share runs during the click before any awaited task/network');
    const shared = new URL(f.events[0].url);
    assert.equal(shared.origin, origin); assert.equal(shared.pathname + shared.search, shareUrl);
    assert.ok(shareUrl.includes('ec1.'), 'use the real encrypted entry, not a cookie-bound lane URL');
    const decoded = entry.readParentGalleryEntryToken(shared.searchParams.get('token'));
    for (const field of ['kind', 'galleryId', 'photographerId', 'pin', 'email']) assert.equal(decoded[field], credentials[field]);
    assert.equal(shared.href.includes('/parents/view/'), false);
    for (const key of ['pin', 'email', 'checkout', 'return', 'session_id']) assert.equal(shared.searchParams.has(key), false);
    for (const secret of [credentials.pin, credentials.email, 'cs_private_browser_return']) assert.equal(shared.href.includes(secret), false);
    await pending;
    assert.equal(f.copies.length, 0); assert.deepEqual(f.notices, ['Share opened']);
  });
  test(`${name} clipboard fallback retains the same encrypted entry and photo context`, async () => {
    const shareUrl = parentGalleryEntryFixture().createParentGalleryEntryPath(credentials);
    const f = fixture({ sessionAccess: { shareUrl }, share: false });
    await f[name](image, 2);
    assert.equal(f.events.length, 0); assert.equal(f.copies.length, 1);
    assert.ok(f.copies[0].endsWith(`${origin}${shareUrl}`));
    assert.equal(f.copies[0].includes('/parents/view/'), false);
    if (name === 'handleShareImage') assert.match(f.copies[0], /Photo 003 · Synthetic-photo/);
    assert.equal(f.notices.length, 1);
  });
  test(`${name} disabled sharing has no browser or clipboard action`, async () => {
    const f = fixture({ enabled: false, sessionAccess: { shareUrl: '/not-used' } });
    await f[name](image, 2);
    assert.deepEqual(f.events, []); assert.deepEqual(f.copies, []); assert.deepEqual(f.notices, []);
  });
  test(`${name} missing private share prop requests gallery reopening without exposing the current lane`, async () => {
    const f = fixture({ sessionAccess: {} });
    await f[name](image, 2);
    assert.deepEqual(f.events, []); assert.deepEqual(f.copies, []);
    assert.deepEqual(f.notices, ['Reopen the gallery before sharing its link.']);
  });
  test(`${name} preserves legacy share URL behavior and user-cancel semantics`, async () => {
    const href = `${origin}/parents/legacy-pin?mode=school&school=legacy-school&email=legacy%40example.test`;
    const f = fixture({ href }); await f[name](image, 2);
    assert.equal(f.events[0].url, href); assert.deepEqual(f.notices, ['Share opened']);
    const cancelled = fixture({ href, shareError: new DOMException('User cancelled', 'AbortError') });
    await cancelled[name](image, 2);
    assert.equal(cancelled.events.length, 1); assert.deepEqual(cancelled.copies, []); assert.deepEqual(cancelled.notices, []);
  });
}
