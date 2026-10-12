import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../app/parents/[pin]/page.tsx', import.meta.url), 'utf8');
const page = ts.createSourceFile('parents.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function openingWithAttribute(name, text) {
  const matches = [];
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) && node.attributes.properties.some((property) =>
      ts.isJsxAttribute(property) && property.name.getText(page) === name &&
      (text === undefined || property.initializer?.getText(page) === JSON.stringify(text)))) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(page); assert.equal(matches.length, 1); return matches[0];
}
function style(opening, state) {
  const value = opening.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText(page) === 'style');
  assert.ok(value && ts.isJsxExpression(value.initializer));
  const code = ts.transpileModule('return (' + value.initializer.expression.getText(page) + ');', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function('context', `with (context) { ${code} }`)(state);
}
const header = openingWithAttribute('data-gallery-header');
const navigation = openingWithAttribute('aria-label', 'Gallery sections');
const actions = openingWithAttribute('data-gallery-header-actions');
const base = { isEventImageStage: false, isEventLanding: false, isMobileViewport: false, isCompactPanelViewport: false, isLightGallery: false,
  galleryTone: { border: '#222', background: '#000' } };

test('desktop gallery tabs reserve normal layout space and the header can wrap without covering its viewer', () => {
  const headerStyle = style(header, base), navigationStyle = style(navigation, base);
  assert.equal(headerStyle.display, 'flex');
  assert.equal(headerStyle.flexWrap, 'wrap');
  assert.equal(headerStyle.flexShrink, 0);
  assert.equal(navigationStyle.position, 'static', 'Absolute centered tabs overlap a wide action bar at laptop widths');
  assert.equal(navigationStyle.flexShrink, 0);
  assert.equal(navigationStyle.left, undefined);
  assert.equal(navigationStyle.transform, undefined);
  const wrapper = header.parent.parent;
  assert.ok(ts.isJsxElement(wrapper));
  const wrapperStyle = style(wrapper.openingElement, { ...base, showEventCover: false, eventCanvasBackground: '#000', galleryFontFamily: 'Arial' });
  assert.equal(wrapperStyle.display, 'flex');
  assert.equal(wrapperStyle.flexDirection, 'column', 'Viewer consumes remaining space after the actual wrapped header height');
});

test('mobile school tabs retain their dedicated final row and mobile event header retains its grid', () => {
  const mobile = { ...base, isMobileViewport: true, isCompactPanelViewport: true };
  const navigationStyle = style(navigation, mobile);
  assert.equal(navigationStyle.position, 'static');
  assert.equal(navigationStyle.order, 99);
  assert.equal(navigationStyle.width, '100%');
  assert.equal(navigationStyle.justifyContent, 'center');
  assert.equal(navigationStyle.borderTop, '1px solid #222');
  const event = { ...mobile, isEventImageStage: true };
  assert.equal(style(header, event).display, 'grid');
  assert.equal(style(header, event).gridTemplateColumns, 'minmax(0, 1fr)');
  assert.equal(style(actions, event).width, '100%');
});
