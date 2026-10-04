import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('shared pending forms preserve named actions, cancelled submits, repeat protection and history navigation',()=>{
 const source=readFileSync('src/layouts/AdminLayout.astro','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
 const form=new EventTarget();const window=new EventTarget();const attributes=new Map();
 const buttons=[0,1].map(()=>({disabled:false,attributes:new Map(),setAttribute(k,v){this.attributes.set(k,v);},removeAttribute(k){this.attributes.delete(k);}}));
 const status={textContent:''};form.querySelectorAll=()=>buttons;form.querySelector=()=>status;
 form.setAttribute=(k,v)=>attributes.set(k,v);form.removeAttribute=k=>attributes.delete(k);
 vm.runInContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,vm.createContext({document:{querySelectorAll:()=>[form]},window}));
 const submit=submitter=>{const event=new Event('submit',{cancelable:true});Object.defineProperty(event,'submitter',{value:submitter});form.dispatchEvent(event);return event;};
 const cancelled=new Event('submit',{cancelable:true});cancelled.preventDefault();form.dispatchEvent(cancelled);assert.equal(status.textContent,'');assert.equal(attributes.has('aria-busy'),false);
 assert.equal(submit(buttons[1]).defaultPrevented,false);assert.equal(status.textContent,'Saving changes. Please wait.');assert.ok(buttons.every(button=>!button.disabled&&button.attributes.get('aria-disabled')==='true'));assert.equal(submit(buttons[0]).defaultPrevented,true);
 window.dispatchEvent(new Event('pageshow'));assert.ok(buttons.every(button=>!button.disabled&&!button.attributes.has('aria-disabled')));assert.equal(attributes.has('aria-busy'),false);assert.equal(status.textContent,'');assert.equal(submit(buttons[0]).defaultPrevented,false);
});
