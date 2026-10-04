import {env} from 'cloudflare:workers';
import {requireLocalAdmin} from '../admin/tournaments.mjs';
import {readMapContext} from '../admin/map-assignments.mjs';
export async function getOfficialToolContext(request:Request,development:boolean,tool:'randomizer'|'veto') {
 const url=new URL(request.url);const tournamentId=url.searchParams.get('adminTournament');
 if(!tournamentId)return null;
 const db=requireLocalAdmin(request,development,env);
 return readMapContext(db,tournamentId,tool==='veto'?{matchId:url.searchParams.get('adminMatch')??undefined}:{roundId:url.searchParams.get('adminRound')??undefined});
}
