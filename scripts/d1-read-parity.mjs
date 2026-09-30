import { diff, plain, loadLegacyStatistics } from './d1-parity.mjs';

export function compareReadMatches(legacyMatches, d1Matches) {
  const statistics = loadLegacyStatistics();
  const normalize = matches => matches.map(m => ({ id: m.id, data: { ...m.data,
    roundDetails: m.data.roundDetails.map(r => ({ ...r, winnerId: statistics.getMapWinner(m, r) })) } }));
  const mismatches = diff(plain(normalize(legacyMatches)), plain(normalize(d1Matches)), 'read.matches');
  const tournaments = [...new Set(legacyMatches.map(m => m.data.tournamentId))];
  for (const id of [null, ...tournaments]) {
    const scope = matches => matches.filter(m => !id || m.data.tournamentId === id);
    diff(plain(statistics.calculateStatistics(scope(legacyMatches))), plain(statistics.calculateStatistics(scope(d1Matches))), `read.statistics.${id ?? 'overall'}`, mismatches);
  }
  return mismatches;
}
