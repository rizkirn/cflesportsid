export interface ContinuitySplit {
  uid: string;
  fromTournament: string;
  beforeTournaments: string[];
  previous: { ign: string; team: string };
}
export const playerContinuitySplits: ContinuitySplit[];
export function historicalPlayerKey(split: ContinuitySplit): string;
export function statisticalPlayerKey(uid: string, tournamentId?: string | null, splits?: ContinuitySplit[]): string;
type Profile = import('astro:content').CollectionEntry<'players'>;
export function statisticalProfiles(players: Profile[], splits?: ContinuitySplit[]): Profile[];
export function matchPlayerProfile(players: Profile[], uid: string, tournamentId?: string | null): Profile | undefined;
