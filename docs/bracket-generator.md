# Bracket generator

Open `/bracket-generator` or use **Tools → Bracket Generator** in the navigation. Veto is also in Tools.

1. Choose the team count, then select exactly that many existing teams. Search matches names and tags; selected teams remain selected when filtered out.
2. Set a new tournament name and ID, start/end dates, an odd fixed map count, and optional third place.
3. Generate and review the rounds. Regenerate reshuffles the same selection and valid BYE positions without a limit.
4. Confirm the draw to lock regeneration and enable copy/download. Unlock to revise it. Changing count, teams or settings invalidates the previous draw and export.

Confirmation only locks the draw in the current page. Download before leaving or reloading. The generator does not publish or write collection files.

The confirmed export area shows Download, Copy and Unlock draw buttons, with feedback after an action. JSON stays in memory rather than appearing in a text area. If clipboard access fails, use Download. Team selection and the draw use each team's existing logo and color; unresolved participants remain text labels.

## Compatibility

The current `src/content.config.ts`, tournament validator, participant resolver and public bracket remain unchanged. Existing tournaments and matches are not modified.

- Brackets use the next power of two, starting at 8. At least 5 entrants are required: fewer cannot fill an 8-slot opening round without BYE vs BYE. The UI maximum follows the Teams collection; the core supports larger collections, including 32/64/128 and beyond.
- Every opening slot receives a team. BYEs are randomized across different pairs of opening matches that feed the next round, with at most one BYE per pair before any pair receives a second. This prevents two BYE recipients meeting immediately whenever possible (including 13 teams in 16 slots). If BYEs exceed one quarter of the bracket size, some such meetings are unavoidable; their count is minimized to `BYEs - bracketSize / 4`. Teams and the choice of position within each pair are still randomized.
- Draw numbers are sequential by round, including automatic BYE slots. Final precedes third place in numbering. For 16 slots, final is Match 15 and third place is Match 16.
- Played match IDs use `<tournament-id>-mNN`, with the draw number preserved. BYEs reserve that number but remain `stages[].byes`, using IDs such as `bye-m03`. They do not become fake completed matches or add wins/statistics.
- Later participants use existing `winner`/`loser` match references or `bye` references. Preview labels show Winner/Loser of Match X. A BYE participant resolves immediately and its next-round team ID is populated.
- All matches start as upcoming with zero scores, empty map/player records, and the tournament start date. Dates are a draft schedule; edit individual match dates before publishing. No results, MVPs or KDA are fabricated.
- Series use the site's existing `fixed-maps` rules, not best-of rules.
- Existing tournament IDs and match IDs embedded at build time are checked for collisions. Recheck against the current repository before importing an older download.

## JSON export

The download is a bundle, not itself a tournament collection entry:

```text
version: 1
files:
  src/data/tournaments/<id>.json: complete tournament JSON
  src/data/matches/<id>-mNN.json: complete match JSON (one per played match)
draw: numbered preview entries, including automatic BYE slots
```

Write each `files` value to its corresponding path after reviewing the schedule and checking that no destination already exists. Keep `draw` and `version` outside the collections. Run `npm run data:check`, `npm test`, and `npm run build` before publishing. There is intentionally no automatic importer or public-site mutation.

## Design direction

Reading this as a tournament draw tool for CFL organizers, using CFL's existing dark surfaces, orange accent and condensed headings. ENERGY 2 / RHYTHM 2 / MOTION 1.

- Palette and typography reuse the public site's tokens to preserve CFL identity.
- The count-first workflow follows the organizer's decisions; only the active step is shown.
- Team rows show real collection names and tags, with native checkboxes and a selection count.
- Orange identifies the primary action and selected teams; no new decorative assets are needed.
- Review uses the tournament-detail bracket layout: advancing matches are centered between their feeders and solid lines show winner/BYE advancement. Third place sits below the final without connecting lines; its participants still reference semifinal losers. Round headings, match surfaces, logos and team color markers follow the tournament page. Phones stack rounds vertically; larger brackets scroll inside their panel on desktop.
- Spacing separates steps, rounds and export controls; motion is limited to inherited hover feedback.

## Verification

`tests/bracket-generator.test.mjs` exercises every team count from 5 through 257, with and without third place, against the existing tournament validator. It checks complete slots, unique entrants, numbering, randomized BYE placement, result progression, collision rejection, and exported data using the actual collection schemas and reference checker.
