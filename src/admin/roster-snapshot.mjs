export const rosterRowsSQL = `(SELECT json_group_array(json_array(team_id,player_id,ign_snapshot,position,player_exists)) FROM (
  SELECT team_id,player_id,ign_snapshot,position,EXISTS(SELECT 1 FROM players p WHERE p.id=r.player_id) AS player_exists FROM tournament_rosters r WHERE tournament_id=?1 ORDER BY team_id,position,player_id
))`;
export function rosterReadiness(participants,rows) {
  const seen=new Set();
  const teams=participants.map(team=>{
    const entries=rows.filter(row=>row[0]===team.id);
    const valid=entries.length>=5 && entries.length<=7 && entries.every(row=>{
      if(row[4]!==1 || seen.has(row[1]) || !row[1] || typeof row[2]!=='string' || !row[2].trim() || row[2].length>120 || /[\p{Cc}\p{Cf}]/u.test(row[2])) return false;
      seen.add(row[1]);return true;
    });
    return {id:team.id,count:entries.length,ready:valid};
  });
  return {teams,ready:participants.length>=2 && teams.every(team=>team.ready) && rows.every(row=>participants.some(team=>team.id===row[0]))};
}
