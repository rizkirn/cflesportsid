export const rosterRowsSQL:string;
export function rosterReadiness(participants:{id:string}[],rows:[string,string,string,number,number][]):{ready:boolean;teams:{id:string;count:number;ready:boolean}[]};
