import { AdminError, readAdminForm } from './tournaments.mjs';
import { readLiveResults, saveLiveResult, seriesWinner } from './live-results.mjs';
import { saveResultCorrection } from './corrections.mjs';

export function readResultEditorForm(request) {
  return readAdminForm(request, { allowedField: key => ['intent','match_id','result_revision','result_type','score1','score2','walkover_winner','reason','confirmed'].includes(key) });
}

export async function saveEditedResult(db, tournamentId, form) {
  if (form.intent !== 'edit-result') throw new AdminError('Unknown result action.');
  const state = await readLiveResults(db, tournamentId);
  const match = state.matches.find(row => row.id === form.match_id);
  if (!match) throw new AdminError('Match not found.', 404);
  if (form.result_revision !== state.revision) throw new AdminError('The bracket changed. Reload before saving.', 409);
  if (!['played','walkover'].includes(form.result_type)) throw new AdminError('Select a result type.');
  if (match.status === 'completed' || match.winner_id) {
    return saveResultCorrection(db, tournamentId, match.id, {...form, intent:'correct-result'});
  }
  if (form.confirmed !== 'yes') throw new AdminError('Confirm the result and progression before saving.');
  if (form.result_type === 'played' && (!/^(0|[1-9]\d*)$/.test(form.score1 ?? '') || !/^(0|[1-9]\d*)$/.test(form.score2 ?? '')
    || !seriesWinner(Number(form.score1), Number(form.score2), match.series_type, match.map_count))) {
    throw new AdminError(match.map_count===3?'Decide all three maps: 3-0, 2-1, 1-2, or 0-3.':`Decide all ${match.map_count} maps with a non-tied result.`);
  }
  return saveLiveResult(db, tournamentId, {...form, intent:form.result_type === 'walkover' ? 'confirm-walkover' : 'edit-initial-result'});
}
