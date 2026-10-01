export interface BracketTeam { id: string; name: string; }
export interface BracketRound { id: string; name: string; order: number; placement?: 1 | 3; }
export type BracketSource = {type: 'winner' | 'loser'; matchId: string} | {type: 'bye'; byeId: string};
export interface BracketStage { id: string; name: string; format: 'single-elimination'; bracketSize: number; series: {type: 'fixed-maps'; mapCount: number}; rounds: BracketRound[]; byes: {id: string; roundId: string; slot: number; teamId: string}[]; }
export interface SharedBracketOptions { tournamentId: string; name: string; game?: string; region?: string; startDate: string; endDate: string; teams: BracketTeam[]; stage: BracketStage; existingMatchIds?: string[]; }
export interface SharedBracket {
  tournament: {id: string; data: {name: string; game: string; region: string; startDate: string; endDate: string; status: 'upcoming'; format: 'single-elimination'; teams: string[]; stages: BracketStage[]}};
  matches: {id: string; data: {tournamentId: string; stageId: string; roundId: string; bracketSlot: number; date: string; status: 'upcoming'; score1: number; score2: number; team1Id?: string; team2Id?: string; team1Source?: BracketSource; team2Source?: BracketSource; roundDetails: []; playerStats: []; stats1: {kills: number; deaths: number; assists: number}; stats2: {kills: number; deaths: number; assists: number}}}[];
  draw: {number: number; roundId: string; slot: number; team1?: string; team2?: string; source1?: number; source2?: number; kind: 'match' | 'bye'}[];
}
export function generateSharedBracket(options: SharedBracketOptions, random?: () => number): SharedBracket;
