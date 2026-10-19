function season(tournament) {
  const number = tournament.id.match(/^clash-for-glory(?:-[a-z0-9]+)*-s([1-9]\d*)$/i)?.[1];
  const value = Number(number);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function compareRegistration(a, b) {
  return a.season - b.season || a.date - b.date ||
    compareText(a.tournamentId, b.tournamentId) || compareText(a.teamId, b.teamId) || compareText(a.ign, b.ign);
}

export function resolveLatestCFGMembership({ players, teams, tournaments, rosters = [] }) {
  const playersById = new Map(players.map(player => [player.id, player]));
  const teamsById = new Map(teams.map(team => [team.id, team]));
  const cfg = new Map(tournaments.flatMap(tournament => {
    const number = season(tournament), date = Date.parse(tournament.data.startDate);
    return number !== null && Number.isFinite(date) ? [[tournament.id, { season: number, date }]] : [];
  }));
  const memberships = new Map();
  const latestTeamRosters = new Map();
  for (const roster of rosters) {
    const chronology = cfg.get(roster.tournamentId);
    if (!chronology || !playersById.has(roster.playerId) || !teamsById.has(roster.teamId) ||
        typeof roster.ign !== 'string' || !roster.ign.trim()) continue;
    const registration = { ...roster, ...chronology };
    const teamRoster = latestTeamRosters.get(roster.teamId);
    if (!teamRoster || compareRegistration(registration, teamRoster) > 0) latestTeamRosters.set(roster.teamId, registration);
    const previous = memberships.get(roster.playerId);
    if (!previous || compareRegistration(registration, previous) > 0) memberships.set(roster.playerId, registration);
  }
  const resolvedPlayers = players.map(player => {
    const membership = memberships.get(player.id);
    return membership ? { ...player, data: { ...player.data, ign: membership.ign, team: membership.teamId } } : player;
  });
  const resolvedById = new Map(resolvedPlayers.map(player => [player.id, player]));
  const currentTeams = new Map();
  for (const [id, membership] of memberships) {
    if (latestTeamRosters.get(membership.teamId)?.tournamentId !== membership.tournamentId) continue;
    const members = currentTeams.get(membership.teamId) ?? [];
    members.push(resolvedById.get(id));
    currentTeams.set(membership.teamId, members);
  }
  for (const members of currentTeams.values()) members.sort((a, b) => {
    const position = player => {
      const value = memberships.get(player.id)?.position;
      return Number.isInteger(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER;
    };
    return position(a) - position(b) || compareText(a.id, b.id);
  });
  function masterTeamPlayers(teamId) {
    return (teamsById.get(teamId)?.data.players ?? []).map(id => resolvedById.get(id)).filter(Boolean);
  }
  function getTeamPlayers(teamId) {
    return [...(latestTeamRosters.has(teamId) ? currentTeams.get(teamId) ?? [] : masterTeamPlayers(teamId))];
  }
  function getTeammates(playerId) {
    const player = resolvedById.get(playerId);
    if (!player) return [];
    const membership = memberships.get(playerId);
    if (!membership) return masterTeamPlayers(player.data.team).filter(p => p.id !== playerId);
    const members = getTeamPlayers(membership.teamId);
    return members.some(p => p.id === playerId) ? members.filter(p => p.id !== playerId) : [];
  }
  return { players: resolvedPlayers, memberships, getTeamPlayers, getTeammates };
}
