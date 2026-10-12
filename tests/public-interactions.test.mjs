import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function element(){const classes=new Set();return {hidden:false,value:'',textContent:'',children:[],dataset:{},listeners:{},classList:{add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)},addEventListener(name,fn){this.listeners[name]=fn;},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},after(){},setAttribute(){},removeAttribute(){},focus(){},select(){},scrollIntoView(){}};}
function script(file){return readFileSync(new URL('../src/components/'+file,import.meta.url),'utf8').split('<script>')[1].split('</script>')[0];}
function run(source,globals){vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:{},...globals});}
test('actual player comparison script selects historical links, calculates stats and resets',()=>{
 const nodes=new Map(), get=k=>{if(!nodes.has(k))nodes.set(k,element());return nodes.get(k);};
 const data={a:[{uid:'1',profileId:'1--before-s2',ign:'Historical',teamTag:'OLD',avatar:'/players/default.webp',totalKills:10,totalDeaths:0,totalAssists:2}],b:[{uid:'2',ign:'Current',teamTag:'NEW',avatar:'/players/default.webp',totalKills:4,totalDeaths:2,totalAssists:1}]};
 get('[data-comparison-data]').textContent=JSON.stringify(data);
 for(const side of ['a','b']){const profile=get(`[data-compare-profile="${side}"]`);profile.querySelector=k=>get(side+k);}
 const selects=['a','b'].map(s=>get(`[data-compare-side="${s}"]`));
 const root={querySelector:get,querySelectorAll:()=>selects};
 run(script('MatchInsights.astro'),{document:{querySelectorAll:()=>[root]}});
 assert.equal(get('[data-comparison-stats]').hidden,true);
 selects[0].value='1';selects[0].listeners.change();assert.equal(get('aa').href,'/players/1--before-s2');assert.equal(get('aa').textContent,'Historical');
 selects[1].value='2';selects[1].listeners.change();assert.equal(get('[data-comparison-stats]').hidden,false);assert.equal(get('[data-value="a-3"]').textContent,'12.00');assert.equal(get('[data-value="b-3"]').textContent,'2.50');
 get('[data-compare-reset]').listeners.click();assert.equal(selects[0].value,'');assert.equal(selects[1].value,'');assert.equal(get('[data-comparison-stats]').hidden,true);
});
test('actual randomizer script draws unique maps, redraws and supports clipboard fallback',async()=>{
 const nodes=new Map(),get=k=>{if(!nodes.has(k))nodes.set(k,element());return nodes.get(k);};
 const maps=[{id:'a',name:'Aztec'},{id:'b',name:'Port'},{id:'c',name:'Ankara'}];
 const root=get('.randomizer');root.dataset={maps:JSON.stringify(maps),economy:'["b"]',official:'false'};
 const cards=maps.map(map=>{const card=element(),label=element();card.dataset.mapId=map.id;card.querySelector=()=>label;return card;});
 get('.pool').querySelectorAll=()=>cards;root.querySelectorAll=()=>[get('#initial-draw'),get('#copy-results')];
 get('#game-mode').value='sd';get('#round-count').value='2';get('#round-count').valueAsNumber=2;
 const form=get('#randomizer-form');form.reportValidity=()=>true;
 const utility={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/utils/map-randomizer.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,utility);
 run(script('tools/MapRandomizerTool.astro').replace(/import \{ randomizeMaps \} from [^;]+;/,''),{randomizeMaps:utility.exports.randomizeMaps,document:{querySelector:get,createElement:element},window:{matchMedia:()=>({matches:true}),confirm:()=>true},navigator:{clipboard:{writeText:async()=>{throw Error('unavailable');}}},clearTimeout(){},setTimeout(){}});
 await form.listeners.submit({preventDefault(){}});assert.equal(get('#map-results').children.length,2);assert.equal(new Set(get('#map-results').children.map(x=>x.children[1].textContent)).size,2);assert.equal(get('#initial-draw').hidden,true);assert.equal(get('#round-count').disabled,false);
 await get('#copy-results').listeners.click();assert.equal(get('#manual-copy').hidden,false);assert.match(get('#manual-copy').value,/Map draw/);
 let submitted=false;form.requestSubmit=()=>submitted=true;get('#draw-again').listeners.click();assert.equal(submitted,true);
 get('#game-mode').value='economy';get('#game-mode').listeners.change();assert.equal(get('#map-results').children.length,0);assert.equal(cards.filter(c=>!c.hidden).length,1);assert.equal(get('#draw').hidden,true);
});
