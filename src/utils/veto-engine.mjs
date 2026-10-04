export function applyVetoAction(pool, steps, history, action) {
  const step=steps[history.length];
  if(!step||action.team!==step.team||action.action!==step.action)throw new Error('Veto action does not match the current step.');
  if(action.voided) {
    if(step.action!=='ban'||action.map!==null)throw new Error('Only an expired ban may be voided.');
  } else if(!pool.includes(action.map)||history.some(row=>!row.voided&&row.map===action.map))throw new Error('Map is no longer available.');
  return [...history,{map:action.map,team:step.team,action:step.action,voided:!!action.voided,automatic:!!action.automatic}];
}
export function remainingVetoMaps(pool, history) {
  return pool.filter(id=>!history.some(row=>!row.voided&&row.map===id));
}
export function resolveVetoResult(pool, steps, history, decider) {
  if(!Array.isArray(history)||history.length!==steps.length)throw new Error('Complete every veto step first.');
  let replay=[];
  for(const action of history)replay=applyVetoAction(pool,steps,replay,action);
  if(!remainingVetoMaps(pool,replay).includes(decider))throw new Error('Map 3 must come from the remaining wheel pool.');
  const picks=['A','B'].map(team=>replay.find(row=>row.team===team&&row.action==='pick')?.map);
  if(picks.some(id=>!id)||new Set([...picks,decider]).size!==3)throw new Error('Each team must pick one distinct map.');
  return [...picks,decider];
}
