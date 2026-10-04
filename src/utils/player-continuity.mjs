import { playerContinuitySplits } from '../config/player-continuity.mjs';

export { playerContinuitySplits };
export const historicalPlayerKey = split => `${split.uid}--before-${split.fromTournament}`;

// UID is continuous by default. Only a confirmed, configured transfer creates a boundary.
export function statisticalPlayerKey(uid, tournamentId, splits = playerContinuitySplits) {
  const split = splits.find(s => s.uid === uid && s.beforeTournaments.includes(tournamentId));
  return split ? historicalPlayerKey(split) : uid;
}

// Presentation entries are not new master players and never alter match-time team attribution.
export function statisticalProfiles(players, splits = playerContinuitySplits) {
  return [...players, ...splits.map(split => {
    const current = players.find(p => (p.data.uid || p.id) === split.uid);
    if (!current) throw new Error(`Missing player for continuity boundary: ${split.uid}`);
    return { ...current, id: historicalPlayerKey(split), data: {
      name: '', uid: split.uid, role: 'Player', status: 'inactive', ...split.previous,
    } };
  })];
}

export function matchPlayerProfile(players, uid, tournamentId) {
  const key = statisticalPlayerKey(uid, tournamentId);
  return statisticalProfiles(players).find(p => p.id === key || (key === uid && p.data.uid === uid));
}
