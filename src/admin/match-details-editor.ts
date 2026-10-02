import { validateDetails, type DetailPayload, type DetailState } from './match-details.mjs';
export function setupDetailEditor() {
  const form=document.querySelector<HTMLFormElement>('[data-detail-editor]');
  if(!form)return;
  const section=form.querySelector<HTMLFieldSetElement>('[data-player-section]')!;
  const locked=section.dataset.locked==='true';
  const state=JSON.parse(form.querySelector('[data-validation-state]')!.textContent!) as DetailState;
  const tabs=Array.from(form.querySelectorAll<HTMLButtonElement>('[data-map-tab]'));
  const panels=Array.from(form.querySelectorAll<HTMLElement>('[data-player-map]'));
  function activate(index:number) {
    tabs.forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;panels[i].hidden=i!==index;});
  }
  tabs.forEach((tab,i)=>{
    tab.addEventListener('click',()=>activate(i));
    tab.addEventListener('keydown',event=>{
      const index=event.key==='Home'?0:event.key==='End'?2:event.key==='ArrowRight'?(i+1)%3:event.key==='ArrowLeft'?(i+2)%3:-1;
      if(index<0)return;event.preventDefault();activate(index);tabs[index].focus();
    });
  });
  form.addEventListener('formdata',event=>{
    panels.forEach((_,i)=>event.formData.delete(`mvp-choice-${i}`));
  });
  const valid=(value:string)=>/^(0|[1-9]\d*)$/.test(value)&&Number.isSafeInteger(Number(value));
  function refresh() {
    let ready=true;let a=0;
    form!.querySelectorAll<HTMLElement>('[data-map-result]').forEach(row=>{
      const map=row.querySelector<HTMLSelectElement>('[data-map-id]')!;
      const scores=Array.from(row.querySelectorAll<HTMLInputElement>('[data-map-score]'));
      const wo=row.querySelector<HTMLSelectElement>('[data-map-mode]')!.value==='walkover';
      row.dataset.mode=wo?'walkover':'played';
      const winner=row.querySelector<HTMLSelectElement>('[data-wo-winner]')!;
      winner.hidden=!wo;winner.disabled=locked||!wo;
      row.querySelector<HTMLElement>('[data-wo-label]')!.hidden=!wo;
      scores.forEach(score=>{score.disabled=locked||wo;score.parentElement!.hidden=wo;});
      const complete=wo?['1','2'].includes(winner.value):!!map.value&&scores.every(s=>valid(s.value))&&Number(scores[0].value)!==Number(scores[1].value);
      if(!complete)ready=false;
      const side=wo?Number(winner.value)-1:Number(scores[0].value)>Number(scores[1].value)?0:1;
      if(complete&&side===0)a++;
      row.querySelector('[data-map-winner]')!.textContent=complete?`Winner: ${wo?winner.selectedOptions[0].textContent:scores[side].labels?.[0]?.textContent?.replace(/ rounds$/,'')}${wo?' · W/O':''}`:'Winner: Pending';
    });
    section.disabled=locked;
    panels.forEach(panel=>panel.inert=!locked&&!ready);
    section.setAttribute('aria-disabled',String(locked||!ready));
    form!.querySelector<HTMLElement>('[data-stats-gate]')!.hidden=ready;
    form!.querySelector('[data-derived-score]')!.textContent=ready?`${a}–${3-a}`:'Incomplete';
    form!.querySelector('[data-reconciliation]')!.textContent=ready?(a===Number(form!.dataset.score1)&&3-a===Number(form!.dataset.score2)?' · Matches confirmed score':' · Conflicts with confirmed score'):'';
    form!.querySelectorAll('[data-player-map]').forEach((map,i)=>{
      const wo=form!.querySelectorAll('[data-map-mode]')[i] as HTMLSelectElement;
      const walkover=wo.value==='walkover';
      map.querySelector<HTMLElement>('[data-wo-stats]')!.hidden=!walkover;
      map.querySelector<HTMLElement>('.detail-team-tables')!.hidden=walkover;
      map.querySelectorAll<HTMLInputElement>('[data-kda]').forEach(input=>input.disabled=locked||walkover);
      map.querySelectorAll('table').forEach(table=>{
        let count=0;
        table.querySelectorAll<HTMLElement>('[data-player-row]').forEach(row=>{
          const values=Array.from(row.querySelectorAll<HTMLInputElement>('[data-kda]')).map(input=>input.value);
          const complete=values.every(valid);
          const choice=row.querySelector<HTMLInputElement>('[data-mvp-choice]')!;
          choice.disabled=locked||walkover||!complete;
          if(!locked&&!complete)choice.checked=false;
          row.dataset.mvp=String(choice.checked);
          if(complete)count++;
          row.querySelectorAll<HTMLInputElement>('[data-kda]').forEach(input=>input.setAttribute('aria-invalid',String(values.some(v=>v!=='')&&!complete)));
        });
        table.querySelector('[data-participation]')!.textContent=`${count} / ${table.querySelectorAll('[data-player-row]').length} players`;
      });
      const mvp=map.querySelector<HTMLInputElement>('input[data-mvp]')!;
      mvp.value=walkover?'':map.querySelector<HTMLInputElement>('[data-mvp-choice]:checked')?.value??'';
      const result=form!.querySelectorAll('[data-map-result]')[i];
      const select=result.querySelector<HTMLSelectElement>('[data-map-id]')!;
      tabs[i].querySelector('[data-tab-label]')!.textContent=`Map ${i+1}${select.value?` · ${select.selectedOptions[0].textContent}`:''}`;
      const started=!!select.value||Array.from(map.querySelectorAll<HTMLInputElement>('[data-kda]')).some(input=>input.value!=='');
      const counts=Array.from(map.querySelectorAll('table')).map(table=>Array.from(table.querySelectorAll('[data-player-row]')).filter(row=>Array.from(row.querySelectorAll<HTMLInputElement>('[data-kda]')).every(input=>valid(input.value))).length);
      tabs[i].querySelector('[data-tab-status]')!.textContent=walkover?'W/O · No stats required':started?(counts.every(count=>count===5)&&!!mvp.value&&!map.querySelector('[aria-invalid="true"]')?'Stats entered':'Needs attention'):'Not started';
    });
    const hint=form!.querySelector('[data-completion-hint]');
    if(hint) {
      const fields=new FormData(form!);
      const payload:DetailPayload={maps:panels.map((panel,i)=>({mode:String(fields.get(`maps.${i}.mode`)??'played') as 'played'|'walkover',winner_side:String(fields.get(`maps.${i}.winner_side`)??''),map_id:String(fields.get(`maps.${i}.map_id`)??''),score1:String(fields.get(`maps.${i}.score1`)??''),score2:String(fields.get(`maps.${i}.score2`)??''),mvp:panel.querySelector<HTMLInputElement>('input[data-mvp]')!.value,players:state.rows.map((row,j)=>({player_id:row.player_id,kills:String(fields.get(`maps.${i}.players.${j}.kills`)??''),deaths:String(fields.get(`maps.${i}.players.${j}.deaths`)??''),assists:String(fields.get(`maps.${i}.players.${j}.assists`)??'')}))}))};
      try{validateDetails(payload,state,true);hint.textContent='Ready to complete.';}catch(error){hint.textContent=error instanceof Error?error.message:'Review match details.';}
    }
  }
  refresh();
  form.addEventListener('input',()=>{
    refresh();form.querySelector('[data-detail-status]')!.textContent='Unsaved changes';
  });
  form.addEventListener('change',event=>{
    if(event.target instanceof HTMLSelectElement&&event.target.matches('[data-map-mode]')) {
      const row=event.target.closest('[data-map-result]')!;
      const index=Array.from(form.querySelectorAll('[data-map-result]')).indexOf(row);
      row.querySelectorAll<HTMLInputElement>('[data-map-score]').forEach(input=>input.value='');
      row.querySelector<HTMLSelectElement>('[data-wo-winner]')!.value='';
      panels[index].querySelectorAll<HTMLInputElement>('[data-kda],input[data-mvp]').forEach(input=>input.value='');
      panels[index].querySelectorAll<HTMLInputElement>('[data-mvp-choice]').forEach(input=>input.checked=false);
    }
    refresh();
  });
  form.addEventListener('submit',event=>{
    if(event.defaultPrevented)return;
    form.querySelector('[data-detail-saving]')!.textContent='Saving match details…';
  });
}
