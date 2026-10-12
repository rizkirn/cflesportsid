import test from 'node:test';
import assert from 'node:assert/strict';
import {renderVetoSteps} from '../src/utils/veto-steps-dom.mjs';

function document(){return {createElement(tag){return {tag,style:{},children:[],setAttribute(key,value){this[key]=value;},append(...nodes){this.children.push(...nodes);},set innerHTML(value){throw new Error('HTML parsing is forbidden');}};}};}
test('veto history and decider names remain text, including hostile markup',()=>{
 const payload='<img src=x onerror="globalThis.compromised=true">';const doc=document();const container={ownerDocument:doc,replaceChildren(...nodes){this.children=nodes;},set innerHTML(value){throw Error('HTML parsing is forbidden');}};
 renderVetoSteps(container,{steps:[{team:'A',action:'pick'},{team:'B',action:'ban'}],history:[{map:'x'},{voided:true}],currentStep:1,phase:'veto',tagA:payload,tagB:'B',decider:'x',mapName:()=>payload});
 assert.equal(container.children[0].children[0].textContent,payload);assert.equal(container.children[0].children[2].textContent,payload);assert.equal(container.children[1].children[2].textContent,'VOID');assert.equal(container.children[2].children[2].textContent,payload);assert.equal(container.children[0].role,'listitem');assert.ok(container.children[1].className.includes('active'));
});
