import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function formScript() {
  const source = readFileSync('src/pages/admin/tournaments/new.astro', 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  const form = new EventTarget();
  const window = new EventTarget();
  const attributes = new Map();
  const button = { disabled: false, textContent: 'Create Tournament', setAttribute: (k, v) => attributes.set(k, v), removeAttribute: k => attributes.delete(k) };
  const status = { textContent: '' };
  form.querySelector = selector => selector === 'button[type="submit"]' ? button : status;
  const context = vm.createContext({ document: { querySelector: () => form }, window });
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const submit = () => { const event = new Event('submit', { cancelable: true }); form.dispatchEvent(event); return event; };
  return { form, window, button, status, attributes, submit };
}

test('pending form preserves native first submission, announces progress, and rejects a second submission', () => {
  const page = formScript();
  assert.equal(page.submit().defaultPrevented, false);
  assert.equal(page.button.disabled, true);
  assert.equal(page.button.textContent, 'Creating Tournament...');
  assert.equal(page.attributes.get('aria-busy'), 'true');
  assert.equal(page.status.textContent, 'Saving the tournament. Please wait.');
  assert.equal(page.submit().defaultPrevented, true);
});

test('cancelled submit stays idle and pageshow restores a usable form after history navigation', () => {
  const page = formScript();
  const cancelled = new Event('submit', { cancelable: true });
  cancelled.preventDefault(); page.form.dispatchEvent(cancelled);
  assert.equal(page.button.disabled, false); assert.equal(page.status.textContent, '');
  page.submit(); page.window.dispatchEvent(new Event('pageshow'));
  assert.equal(page.button.disabled, false); assert.equal(page.button.textContent, 'Create Tournament');
  assert.equal(page.attributes.has('aria-busy'), false); assert.equal(page.status.textContent, '');
  assert.equal(page.submit().defaultPrevented, false);
});
