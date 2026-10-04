import {validateDetails,type DetailPayload,type DetailState} from './match-details.mjs';
export function setupGuidedDetails(){
 const form=document.querySelector<HTMLFormElement>('[data-details-form]');if(!form)return;
 const dialog=document.querySelector<HTMLDialogElement>('[data-guided-dialog]')!;const guided=form.dataset.guided==='true';
 if(guided)dialog.showModal();
 const state=JSON.parse(form.querySelector('[data-validation-state]')!.textContent!) as DetailState;
 const tabs=Array.from(form.querySelectorAll<HTMLButtonElement>('[data-map-tab]'));const panels=Array.from(form.querySelectorAll<HTMLElement>('[data-map-panel]'));
 const status=form.querySelector('[data-detail-status]')!;const error=form.querySelector('[data-detail-error]')!;const revision=form.querySelector<HTMLInputElement>('[name=revision]')!;
 let current=0;let dirty=false;let generation=0;let timer:ReturnType<typeof setTimeout>;let active:Promise<boolean>|null=null;let leaving=false;let navigating=false;
 const fields=()=>{const data=new FormData(form);panels.forEach((_,i)=>data.delete(`mvp-choice-${i}`));return new URLSearchParams(Array.from(data.entries()).map(([key,value])=>[key,String(value)]));};
 const payload=():DetailPayload=>{const data=fields();return {maps:panels.map((_,i)=>({mode:data.get(`maps.${i}.mode`) as 'played'|'walkover',winner_side:data.get(`maps.${i}.winner_side`)??'',map_id:data.get(`maps.${i}.map_id`)??'',score1:data.get(`maps.${i}.score1`)??'',score2:data.get(`maps.${i}.score2`)??'',mvp:data.get(`maps.${i}.mvp`)??'',players:state.rows.map((_,j)=>({player_id:data.get(`maps.${i}.players.${j}.player_id`)??'',kills:data.get(`maps.${i}.players.${j}.kills`)??'',deaths:data.get(`maps.${i}.players.${j}.deaths`)??'',assists:data.get(`maps.${i}.players.${j}.assists`)??''}))}))};};
 const valid=(value:string)=>/^(0|[1-9]\d*)$/.test(value)&&Number.isSafeInteger(Number(value));
 function refresh(){
 let a=0;let decided=0;
 panels.forEach((panel,i)=>{
 const wo=panel.querySelector<HTMLSelectElement>('[data-mode]')!.value==='walkover';
 panel.querySelectorAll<HTMLElement>('[data-played]').forEach(group=>{group.hidden=wo;group.querySelectorAll<HTMLInputElement>('input').forEach(input=>input.disabled=wo);});
 panel.querySelectorAll<HTMLElement>('[data-walkover]').forEach(group=>{group.hidden=!wo;group.querySelectorAll<HTMLSelectElement>('select').forEach(select=>select.disabled=!wo);});
 let ready=true;
 panel.querySelectorAll('table').forEach(table=>{let count=0;table.querySelectorAll('[data-stat-row]').forEach(row=>{const values=Array.from(row.querySelectorAll<HTMLInputElement>('[data-kda]')).map(input=>input.value);const playing=values.every(valid);const mvp=row.querySelector<HTMLInputElement>('[data-mvp-choice]')!;mvp.disabled=wo||!playing;if(!playing)mvp.checked=false;if(playing)count++;});table.querySelector('[data-player-count]')!.textContent=`${count}/5 played`;if(count!==5)ready=false;});
 const mvp=panel.querySelector<HTMLInputElement>('[data-mvp]')!;mvp.value=wo?'':panel.querySelector<HTMLInputElement>('[data-mvp-choice]:checked')?.value??'';
 const data=fields();const s1=data.get(`maps.${i}.score1`)??'';const s2=data.get(`maps.${i}.score2`)??'';const winner=data.get(`maps.${i}.winner_side`);const map=data.get(`maps.${i}.map_id`);
 const mapReady=wo?['1','2'].includes(winner??''):!!map&&valid(s1)&&valid(s2)&&Number(s1)!==Number(s2);
 if(mapReady){decided++;if(wo?winner==='1':Number(s1)>Number(s2))a++;}
 const complete=mapReady&&(wo||ready&&!!mvp.value);
 tabs[i].dataset.stepComplete=String(complete);
 tabs[i].querySelector('[data-step-status]')!.textContent=complete?(wo?'✓ W/O':'✓ Complete'):i===current?'● Editing':s1||s2||winner?'Needs attention':'Not started';
 });
 form!.querySelector('[data-derived-score]')!.textContent=decided===3?`Maps: ${a}-${3-a} · Confirmed: ${state.match.score1}-${state.match.score2}${a===state.match.score1?'':' · Review winners'}`:`${decided}/3 maps decided`;
 }
 function activate(index:number){current=index;tabs.forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;panels[i].hidden=i!==index;});const previous=form!.querySelector<HTMLElement>('[data-previous]');if(previous)previous.hidden=index===0;const next=form!.querySelector<HTMLElement>('[data-next]');if(next)next.hidden=index===2;const complete=form!.querySelector<HTMLElement>('[data-complete]');if(complete)complete.hidden=index!==2;refresh();}
 async function save(intent='save-draft'):Promise<boolean>{
 clearTimeout(timer);if(active){if(!await active)return false;return save(intent);}if(intent==='save-draft'&&!dirty)return true;
 const version=generation;const data=fields();data.set('intent',intent);status.textContent=intent==='save-draft'?'Saving draft…':'Saving details…';
 const task=(async()=>{try{const response=await fetch(window.location.href,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json'},body:data});const result=await response.json();if(!response.ok)throw new Error(result.error??'Could not save draft.');revision.value=result.revision;dirty=generation!==version;status.textContent=dirty?'Unsaved changes':'Draft saved';error.textContent='';if(intent!=='save-draft'){leaving=true;window.location.assign(`${window.location.pathname}?saved=complete`);}return true;}catch(cause){error.textContent=cause instanceof Error?cause.message:'Could not save details.';status.textContent='Unsaved changes';return false;}})();active=task;const result=await task;active=null;return result;
 }
 async function close(){if(await save()){leaving=true;window.location.assign(`/admin/tournaments/${encodeURIComponent(state.match.tournament_id)}/matches`);}}
 async function navigate(index:number){if(navigating)return;navigating=true;try{if(!guided||await save())activate(index);}finally{navigating=false;}}
 tabs.forEach((tab,i)=>{tab.addEventListener('click',async()=>{if(!guided||await save())activate(i);});tab.addEventListener('keydown',async event=>{const index=event.key==='ArrowRight'?(i+1)%3:event.key==='ArrowLeft'?(i+2)%3:event.key==='Home'?0:event.key==='End'?2:-1;if(index>=0){event.preventDefault();if(!guided||await save()){activate(index);tabs[index].focus();}}});});
 form.querySelector('[data-next]')?.addEventListener('click',()=>void navigate(current+1));form.querySelector('[data-previous]')?.addEventListener('click',()=>void navigate(current-1));document.querySelectorAll('[data-guided-close]').forEach(button=>button.addEventListener('click',close));dialog.addEventListener('cancel',event=>{event.preventDefault();void close();});
 form.addEventListener('formdata',event=>panels.forEach((_,i)=>event.formData.delete(`mvp-choice-${i}`)));
 form.addEventListener('input',()=>{dirty=true;generation++;refresh();status.textContent='Unsaved changes';if(guided){clearTimeout(timer);timer=setTimeout(()=>void save(),700);}});
 form.addEventListener('change',event=>{const target=event.target as HTMLSelectElement;if(target.matches('[data-mode]')){const panel=target.closest('[data-map-panel]')!;panel.querySelectorAll<HTMLInputElement>('input:not([type=hidden])').forEach(input=>{if(input.type==='radio')input.checked=false;else input.value='';});panel.querySelector<HTMLSelectElement>('[name$=winner_side]')!.value='';}dirty=true;generation++;refresh();if(guided){clearTimeout(timer);timer=setTimeout(()=>void save(),700);}});
 form.addEventListener('submit',event=>{event.preventDefault();refresh();try{validateDetails(payload(),state,true);}catch(cause){error.textContent=cause instanceof Error?cause.message:'Review all maps.';return;}const submitter=(event as SubmitEvent).submitter as HTMLButtonElement;form.inert=true;void save(submitter?.value??'complete-details').then(saved=>{if(!saved)form.inert=false;});});
 window.addEventListener('beforeunload',event=>{if(dirty&&!leaving){event.preventDefault();event.returnValue='';}});
 refresh();activate(0);
}
