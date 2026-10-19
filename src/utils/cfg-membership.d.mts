import type { CollectionEntry } from 'astro:content';
import type { PublicRoster } from '../data-access/public-d1.mjs';
type Player = CollectionEntry<'players'>;
type Team = CollectionEntry<'teams'>;
type Tournament = CollectionEntry<'tournaments'>;
export interface CFGRegistration extends PublicRoster { season: number; date: number }
export function resolveLatestCFGMembership(input: {
  players: Player[];
  teams: Team[];
  tournaments: Tournament[];
  rosters?: PublicRoster[];
}): {
  players: Player[];
  memberships: Map<string, CFGRegistration>;
  getTeamPlayers(teamId: string): Player[];
  getTeammates(playerId: string): Player[];
};
