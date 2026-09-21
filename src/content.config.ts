import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const tournaments = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/data/tournaments' }),
  schema: z.object({
    name: z.string(),
    game: z.string().default('crossfire-legends'),
    region: z.string().default('ID'),
    startDate: z.string(),
    endDate: z.string(),
    status: z.enum(['upcoming', 'ongoing', 'completed']).default('upcoming'),
    format: z.literal('single-elimination'),
    stages: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      format: z.literal('single-elimination'),
      bracketSize: z.number().int().min(2).refine(n => Number.isInteger(Math.log2(n)), 'Bracket size must be a power of two'),
      series: z.object({
        type: z.literal('fixed-maps'),
        mapCount: z.number().int().positive().refine(n => n % 2 === 1, 'Use an odd map count to avoid ties'),
      }),
      veto: z.object({
        steps: z.array(z.object({ team: z.enum(['A', 'B']), action: z.enum(['ban', 'pick']) })).min(2),
        finalMap: z.literal('random'),
        actionSeconds: z.number().int().positive(),
        reserveSeconds: z.number().int().positive(),
      }).optional(),
      rounds: z.array(z.object({
        round_number: z.number().int().positive().optional(),
        id: z.string().min(1),
        name: z.string().min(1),
        order: z.number().int().positive(),
        placement: z.union([z.literal(1), z.literal(3)]).optional(),
      })).min(1),
      byes: z.array(z.object({
        id: z.string().min(1),
        roundId: z.string().min(1),
        slot: z.number().int().positive(),
        teamId: z.string().min(1),
      })).default([]),
    })).min(1),
    teams: z.array(z.string()).default([]),
    winner: z.string().optional(),
  }),
});

const maps = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/data/maps' }),
  schema: z.object({
    name: z.string(),
    game: z.string().default('crossfire-legends'),
    active: z.boolean().default(true),
    thumbnail: z.string().min(1).optional(),
  }),
});

const teams = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/data/teams' }),
  schema: z.object({
    name: z.string(),
    tag: z.string(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex team color, e.g. #FF5A1F').optional(),
    logo: z.string().optional(),
    region: z.string(),
    founded: z.string().optional(),
    description: z.string().optional(),
    placementPoints: z.number().default(0),
    players: z.array(z.string()).default([]),
    stats: z.object({
      wins: z.number().default(0),
      losses: z.number().default(0),
      draws: z.number().default(0),
      matchesPlayed: z.number().default(0),
    }).default({ wins: 0, losses: 0, draws: 0, matchesPlayed: 0 }),
  }),
});

const players = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/data/players' }),
  schema: z.object({
    name: z.string(),
    ign: z.string(),
    uid: z.string().nullable().optional(),
    team: z.string().optional(),
    role: z.string().default('Player'),
    avatar: z.string().optional(),
    country: z.string().optional(),
    bio: z.string().optional(),
    socials: z.object({
      discord: z.string().optional(),
      twitter: z.string().optional(),
      youtube: z.string().optional(),
      twitch: z.string().optional(),
    }).default({}),
    stats: z.object({
      kills: z.number().default(0),
      deaths: z.number().default(0),
      assists: z.number().default(0),
      matchesPlayed: z.number().default(0),
      mvpCount: z.number().default(0),
    }).default({ kills: 0, deaths: 0, assists: 0, matchesPlayed: 0, mvpCount: 0 }),
  }),
});

const participantSource = z.discriminatedUnion('type', [
  z.object({ type: z.literal('winner'), matchId: z.string().min(1) }),
  z.object({ type: z.literal('loser'), matchId: z.string().min(1) }),
  z.object({ type: z.literal('bye'), byeId: z.string().min(1) }),
]);

const matches = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/data/matches' }),
  schema: z.object({
    tournamentId: z.string().min(1),

    stageId: z.string().min(1),
    roundId: z.string().min(1),
    team1Source: participantSource.optional(),
    team2Source: participantSource.optional(),
    date: z.string(),

    team1Id: z.string().min(1).optional(),

    team2Id: z.string().min(1).optional(),
    score1: z.number().int().nonnegative().default(0),
    score2: z.number().int().nonnegative().default(0),
    winnerId: z.string().min(1).optional(),
    status: z.enum(['upcoming', 'live', 'completed']).default('upcoming'),
    bracketSlot: z.number().int().positive(),
    roundDetails: z.array(z.object({
      round_number: z.number(),
      mapId: z.string().min(1),
      winnerId: z.string().min(1).optional(),
      resultNote: z.string().min(1).optional(),
      mvp: z.string().nullable().optional(),
    })).default([]),
    duration: z.string().optional(),
    mvp: z.string().optional(),
    stats1: z.object({
      kills: z.number().int().nonnegative().default(0),
      deaths: z.number().int().nonnegative().default(0),
      assists: z.number().int().nonnegative().default(0),
    }).default({ kills: 0, deaths: 0, assists: 0 }),
    stats2: z.object({
      kills: z.number().int().nonnegative().default(0),
      deaths: z.number().int().nonnegative().default(0),
      assists: z.number().int().nonnegative().default(0),
    }).default({ kills: 0, deaths: 0, assists: 0 }),
    playerStats: z.array(z.object({
      teamId: z.string().min(1).nullable(),
      uid: z.string().nullable().optional(),
      ign: z.string().optional(),
      rounds: z.array(z.object({
        round_number: z.number().int().positive().optional(),
        kills: z.number().int().nonnegative().default(0),
        deaths: z.number().int().nonnegative().default(0),
        assists: z.number().int().nonnegative().default(0),
      })).default([]),
    })).default([]),
  }).superRefine((match, ctx) => {
    const knownMapWins = { team1: 0, team2: 0 };
    match.roundDetails.forEach((round, index) => {
      if (!round.winnerId) return;
      if (round.winnerId === match.team1Id) knownMapWins.team1++;
      else if (round.winnerId === match.team2Id) knownMapWins.team2++;
      else ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['roundDetails', index, 'winnerId'], message: 'Map winner must be one of the match teams.' });
    });
    if (match.status === 'completed' && (knownMapWins.team1 > match.score1 || knownMapWins.team2 > match.score2)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['roundDetails'], message: 'Recorded map winners disagree with the match score.' });
    }
    const uids = new Set<string>();
    match.playerStats.forEach((playerStats, index) => {
      if (playerStats.uid && uids.has(playerStats.uid)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['playerStats', index, 'uid'], message: 'Duplicate player in match.' });
      }
      if (playerStats.uid) uids.add(playerStats.uid);
      const roundNumbers = new Set<number>();
      playerStats.rounds.forEach((round, roundIndex) => {
        if (round.round_number === undefined) return;
        if (roundNumbers.has(round.round_number) || !match.roundDetails.some(rd => rd.round_number === round.round_number)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['playerStats', index, 'rounds', roundIndex, 'round_number'], message: 'Map number must exist in roundDetails and cannot repeat for a player.' });
        }
        roundNumbers.add(round.round_number);
      });
      if (playerStats.teamId !== null &&
          playerStats.teamId !== match.team1Id &&
          playerStats.teamId !== match.team2Id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['playerStats', index, 'teamId'],
          message: 'Player match team must be one of the two match teams, or null if unknown.',
        });
      }
    });
  }),
});

export const collections = { tournaments, maps, teams, players, matches };
