export interface VetoStep {team:'A'|'B';action:'ban'|'pick';}
export interface VetoAction extends VetoStep {map:string|null;voided?:boolean;automatic?:boolean;}
export function applyVetoAction(pool:string[],steps:VetoStep[],history:VetoAction[],action:VetoAction):VetoAction[];
export function remainingVetoMaps(pool:string[],history:VetoAction[]):string[];
export function resolveVetoResult(pool:string[],steps:VetoStep[],history:VetoAction[],decider:string):string[];
