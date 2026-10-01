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

test('setup save and round edits guard repeat submission and reset both save buttons', () => {
  const source=readFileSync('src/pages/admin/tournaments/[id]/setup.astro','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  const form=new EventTarget(); const window=new EventTarget(); const attributes=new Map();
  const buttons=[{disabled:false,textContent:'Save & Continue'},{disabled:false,textContent:'Save & Continue'}];
  const status={textContent:''}; form.querySelectorAll=()=>buttons; form.querySelector=()=>status;
  form.setAttribute=(k,v)=>attributes.set(k,v); form.removeAttribute=k=>attributes.delete(k);
  vm.runInContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,vm.createContext({document:{querySelector:()=>form},window}));
  const submit=submitter=>{const e=new Event('submit',{cancelable:true}); Object.defineProperty(e,'submitter',{value:submitter}); form.dispatchEvent(e); return e;};
  assert.equal(submit(buttons[1]).defaultPrevented,false); assert.equal(status.textContent,'Saving setup. Please wait.');
  assert.ok(buttons.every(b=>b.disabled && b.textContent==='Saving Setup...')); assert.equal(submit(buttons[0]).defaultPrevented,true);
  window.dispatchEvent(new Event('pageshow')); assert.ok(buttons.every(b=>!b.disabled && b.textContent==='Save & Continue'));
  const edit={}; assert.equal(submit(edit).defaultPrevented,false); assert.equal(status.textContent,'Updating round fields. Please wait.');
  assert.equal(attributes.get('aria-busy'),'true'); window.dispatchEvent(new Event('pageshow')); assert.equal(attributes.has('aria-busy'),false);
});
