import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveLatestCFGMembership} from '../src/utils/cfg-membership.mjs';
const tournament = (n, extra = {}) => ({id:`clash-for-glory-s${n}`,data:{startDate:`20${String(n).padStart(2,'0')}-01-01`},...extra});
const player = (id, team = 'a') => ({id,collection:'players',data:{uid:id,ign:`Master ${id}`,team,photo_asset_key:`players/${id}/photo`,stats:{kills:42}}});
const team = (id, players = []) => ({id,data:{players}});
const registration = (playerId, season, teamId, ign = `IGN S${season}`) => ({playerId,tournamentId:`clash-for-glory-s${season}`,teamId,ign});
const resolve = (rosters, extra = {}) => resolveLatestCFGMembership({players:[player('p')],teams:[team('a'),team('b')],tournaments:[1,2,3,4,9,10].map(n=>tournament(n)),rosters,...extra});

test('latest CFG registration changes presentation without changing ID, assets, statistics or input',()=>{
 const p=player('p'),input={players:[p],teams:[team('a'),team('b')],tournaments:[tournament(1),tournament(3)],rosters:[registration('p',1,'a'),registration('p',3,'b','Renamed')]};const before=JSON.stringify(input);const result=resolveLatestCFGMembership(input).players[0];assert.equal(result.data.ign,'Renamed');assert.equal(result.data.team,'b');assert.equal(result.id,'p');assert.equal(result.data.photo_asset_key,p.data.photo_asset_key);assert.equal(result.data.stats,p.data.stats);assert.equal(JSON.stringify(input),before);
});
test('absence from newer CFG seasons preserves the last individual registration',()=>{
 assert.equal(resolve([registration('p',1,'a'),registration('p',2,'b')]).players[0].data.team,'b');assert.equal(resolve([registration('p',1,'a')]).players[0].data.ign,'IGN S1');
});
test('returning players use the latest team and numeric season chronology, not lexical IDs',()=>{
 assert.equal(resolve([registration('p',1,'a'),registration('p',2,'b'),registration('p',4,'a')]).players[0].data.team,'a');assert.equal(resolve([registration('p',9,'a'),registration('p',10,'b')]).players[0].data.team,'b');
});
test('unrelated tournaments, invalid snapshots and missing roster data retain master fallback',()=>{
 const master=player('p');const result=resolve([{...registration('p',1,'b'),tournamentId:'other-event-s99'},registration('p',3,'missing'),registration('p',4,'b',' ')],{players:[master],tournaments:[tournament(3),tournament(4),{id:'other-event-s99',data:{startDate:'2099-01-01'}}]});assert.equal(result.players[0],master);assert.equal(resolve([]).players[0].data.ign,'Master p');
});
test('competitive identity IDs are resolved before selection, never joined by shared UID',()=>{
 const uid='1345266890',ids=[uid+'--before-clash-for-glory-s2',uid+'--before-clash-for-glory-road-to-all-star-s3',uid];const players=ids.map(id=>({...player(id),data:{...player(id).data,uid}}));const registrations=[registration(ids[0],1,'a','KangDedy'),registration(ids[1],2,'b','KucayyPRMX'),registration(ids[2],3,'b','VinPRMX')];const actual=resolve(registrations,{players}).players;assert.deepEqual(actual.map(p=>[p.id,p.data.ign]),ids.map((id,i)=>[id,['KangDedy','KucayyPRMX','VinPRMX'][i]]));
});
test('duplicate ordering and season/date ties produce stable results',()=>{
 const rows=[registration('p',2,'b','Z'),registration('p',2,'a','A'),registration('p',1,'a')];assert.deepEqual(resolve(rows).players,resolve([...rows].reverse()).players);
});

test('a newer team roster retires omitted members while preserving their latest-known profile',()=>{
 const r=resolve([registration('p',1,'a','Old P'),registration('q',3,'a','New Q')],{players:[player('p'),player('q')],teams:[team('a',['p','q'])]});assert.equal(r.players.find(p=>p.id==='p').data.ign,'Old P');assert.deepEqual(r.getTeamPlayers('a').map(p=>p.id),['q']);assert.deepEqual(r.getTeammates('p'),[]);
});
test('teams absent from newer seasons retain only members who have not transferred',()=>{
 const r=resolve([registration('p',1,'a'),registration('q',1,'a'),registration('q',3,'b'),registration('r',4,'b')],{players:['p','q','r'].map(x=>player(x)),teams:[team('a',['p','q']),team('b',['r'])]});assert.deepEqual(r.getTeamPlayers('a').map(p=>p.id),['p']);assert.deepEqual(r.getTeamPlayers('b').map(p=>p.id),['r']);
});
test('returning players rejoin automatically and teammates share team membership and IGN',()=>{
 const r=resolve([registration('p',1,'a'),registration('p',2,'b'),registration('p',4,'a','Returned P'),registration('q',4,'a','Latest Q')],{players:[player('p'),player('q')],teams:[team('a',['p','q']),team('b')]});assert.deepEqual(r.getTeamPlayers('a').map(p=>p.data.ign),['Returned P','Latest Q']);assert.deepEqual(r.getTeammates('p').map(p=>p.id),r.getTeamPlayers('a').filter(p=>p.id!=='p').map(p=>p.id));assert.deepEqual(r.getTeamPlayers('b'),[]);
});
test('a historical team can have zero remaining current members',()=>{
 const r=resolve([registration('p',1,'a'),registration('p',2,'b')],{teams:[team('a',['p']),team('b')]});assert.deepEqual(r.getTeamPlayers('a'),[]);assert.equal(r.players.length,1);
});
test('players and teams without CFG history preserve master membership and teammate fallbacks',()=>{
 const p=player('p'),q=player('q');const r=resolve([],{players:[p,q],teams:[team('a',['p','q'])]});assert.deepEqual(r.getTeamPlayers('a'),[p,q]);assert.deepEqual(r.getTeammates('p'),[q]);assert.equal(r.players[0],p);
});
test('unrelated tournament registrations cannot retire a CFG team roster',()=>{
 const r=resolve([registration('p',1,'a'),{...registration('q',4,'a'),tournamentId:'unrelated-s99'}],{players:[player('p'),player('q')],tournaments:[tournament(1),{id:'unrelated-s99',data:{startDate:'2099-01-01'}}]});assert.deepEqual(r.getTeamPlayers('a').map(p=>p.id),['p']);
});
test('all membership lists are deterministic, detached arrays ordered by saved position then player ID',()=>{
 const rosters=[{...registration('p',3,'a'),position:2},{...registration('q',3,'a'),position:1}];const input={players:[player('p'),player('q')],teams:[team('a')]};const a=resolve(rosters,input),b=resolve([...rosters].reverse(),{...input,players:[...input.players].reverse()});assert.deepEqual(a.getTeamPlayers('a').map(p=>p.id),['q','p']);assert.deepEqual(a.getTeamPlayers('a'),b.getTeamPlayers('a'));a.getTeamPlayers('a').pop();assert.equal(a.getTeamPlayers('a').length,2);
});

test('G2C S3 displays exactly seven approved identities and excludes prior-season omissions',()=>{
 const ids=['1185225620','1710216868','1308508064','1935026098','1551933778','1656689899','1345266890'];const names=['PinkyPRMX','DurenPRMX','KidoPRMX','MineralPRMX','GreezyPRMX','NoyPRMX','VinPRMX'];const former='1741464352',historical='1345266890--before-clash-for-glory-road-to-all-star-s3';const rosters=[...ids.map((id,i)=>({...registration(id,3,'g2c-prmx',names[i]),position:i+1})),registration(former,2,'g2c-prmx','KUTUKANPRMX'),registration(historical,2,'g2c-prmx','KucayyPRMX')];const input={players:[...ids,former,historical].map(id=>player(id,'g2c-prmx')),teams:[team('g2c-prmx',[...ids,former,historical])]};const r=resolve(rosters,input);assert.deepEqual(r.getTeamPlayers('g2c-prmx').map(p=>p.data.ign),names);for(const id of ids)assert.equal(r.getTeammates(id).length,6);assert.deepEqual(r.getTeammates(former),[]);assert.equal(r.players.find(p=>p.id===historical).data.ign,'KucayyPRMX');assert.equal(r.players.length,9);
});
