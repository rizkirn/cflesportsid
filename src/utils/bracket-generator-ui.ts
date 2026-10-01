import { createBracketImage } from './bracket-image';
import {
  bracketSizeFor,
  generateBracket,
  bracketExport,
  type BracketOptions,
  type GeneratedBracket
} from './bracket-generator';

type CatalogTeam = {
  id: string;
  name: string;
  logo: string;
  color: string;
};

type Catalog = {
  teams: CatalogTeam[];
  tournamentIds: string[];
  matchIds: string[];
};

export function initializeBracketGenerator() {
  const root =
    document.querySelector<HTMLElement>('.generator');

  if (!root) return;

  const element = <T extends HTMLElement>(
    id: string
  ) =>
    root.querySelector<T>(`#${id}`)!;

  const input = (id: string) =>
    element<HTMLInputElement>(id);

  const button = (id: string) =>
    element<HTMLButtonElement>(id);

  const error =
    element('generator-error');

  const reportError = (message: string) => {
    error.textContent = message;
    error.hidden = !message;
  };

  try {
    /* CATALOG */

    const catalog =
      JSON.parse(
        root.dataset.catalog!
      ) as Catalog;

    const teams =
      new Map(
        catalog.teams.map(team => [
          team.id,
          team
        ])
      );

    const checks =
      Array.from(
        root.querySelectorAll<HTMLInputElement>(
          'input[name="team"]'
        )
      );

    const sections = [
      'count-form',
      'selection',
      'settings',
      'preview'
    ];

    /* STATE */

    let count = 0;

    let options:
      BracketOptions | undefined;

    let bracket:
      GeneratedBracket | undefined;

    let confirmed = false;

    let exportJson = '';

    let generation = 0;

    let revision = 0;

    /* HELPERS */

    const selected = () =>
      checks
        .filter(check => check.checked)
        .map(check => check.value);

    const summary = () =>
      `${count} teams · ${bracketSizeFor(count)} slots · ${
        bracketSizeFor(count) - count
      } BYEs`;

    const slugify = (value: string) =>
      value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    /* SHOW STAGE */

    const show = (
    id: string,
    focusId: string
  ) => {
    sections.forEach(section => {
      element(section).hidden =
        section !== id;
    });

    reportError('');

    requestAnimationFrame(() => {
      element(focusId).focus();
    });
  };

    /* INVALIDATE DRAW */

    const invalidate = () => {
      revision++;

      bracket = undefined;
      confirmed = false;
      generation = 0;

      element(
        'export-controls'
      ).hidden = true;

      exportJson = '';

      element(
        'export-status'
      ).textContent = '';
    };

    /* TEAM SELECTION */

    const updateSelection = () => {
      const total =
        selected().length;

      checks.forEach(check => {
        check.disabled =
          !check.checked &&
          total >= count;
      });

      element(
        'selection-status'
      ).textContent =
        total === count
          ? `${total} / ${count} selected. Ready to continue.`
          : `${total} / ${count} selected. Choose ${
              count - total
            } more teams.`;

      button(
        'continue-settings'
      ).disabled =
        total !== count;

      button(
        'clear-teams'
      ).disabled =
        total === 0;
    };

    const filterTeams = () => {
      const query =
        input('team-search')
          .value
          .trim()
          .toLowerCase();

      const rows =
        Array.from(
          root.querySelectorAll<HTMLElement>(
            '.team-option'
          )
        );

      rows.forEach(row => {
        row.hidden =
          !row.dataset
            .search!
            .includes(query);
      });

      element(
        'no-teams'
      ).hidden =
        rows.some(row => !row.hidden);
    };

    const customTeams = new Map<string, {id: string; name: string}>();
    const reportCustomError = (message: string) => {
      const error = element('custom-team-error'); error.textContent = message; error.hidden = !message;
      input('custom-team-name').setAttribute('aria-invalid', String(Boolean(message)));
    };
    element<HTMLFormElement>('custom-team-form').addEventListener('submit', event => {
      event.preventDefault();
      const name = input('custom-team-name').value.normalize('NFKC').trim().replace(/ +/g, ' ');
      if (!name || name.length > 120 || /[\p{Cc}\p{Cf}]/u.test(name)) { reportCustomError('Enter 1 to 120 readable characters for the custom team name.'); return; }
      if (Array.from(teams.values()).some(team => team.name.normalize('NFKC').trim().replace(/ +/g, ' ').toLowerCase() === name.toLowerCase())) { reportCustomError('A team with this name is already available. Select the existing team.'); return; }
      if (teams.size >= 1024) { reportCustomError('Remove a custom team before adding another.'); return; }
      const id = `custom-${crypto.randomUUID()}`;
      customTeams.set(id,{id,name});
      teams.set(id,{id,name,logo:'/logos/default.webp',color:'#FF5A1F'});
      const row = document.createElement('div'); row.className = 'team-option custom-team-option'; row.dataset.search = name.toLowerCase();
      const label = document.createElement('label');
      const check = document.createElement('input'); check.type='checkbox'; check.name='team'; check.value=id; check.checked=selected().length<count;
      const text = document.createElement('span'); text.textContent=name;
      label.append(check,text); row.append(label); checks.push(check); check.addEventListener('change',updateSelection);
      const remove = document.createElement('button'); remove.type='button'; remove.textContent='Remove'; remove.setAttribute('aria-label',`Remove ${name}`);
      remove.addEventListener('click',()=>{checks.splice(checks.indexOf(check),1);customTeams.delete(id);teams.delete(id);row.remove();reportCustomError('');invalidate();updateSelection();filterTeams();input('custom-team-name').focus();});
      row.append(remove); element('custom-team-list').append(row);
      input('custom-team-name').value=''; reportCustomError(''); invalidate(); updateSelection(); filterTeams(); input('custom-team-name').focus();
    });

    /* TEAM COUNT */

    input(
      'team-count'
    ).addEventListener(
      'input',
      () => {
        const field =
          input('team-count');

        const value =
          Number(field.value);

        if (
          !field.validity.valid ||
          !Number.isSafeInteger(value) ||
          value < 5
        ) {
          element(
            'count-summary'
          ).textContent = '';

          return;
        }

        try {
          const size =
            bracketSizeFor(value);

          element(
            'count-summary'
          ).textContent =
            `${size} slots · ${
              size - value
            } BYEs`;
        } catch {
          element(
            'count-summary'
          ).textContent = '';
        }
      }
    );

    element<HTMLFormElement>(
      'count-form'
    ).addEventListener(
      'submit',
      event => {
        event.preventDefault();

        const form =
          element<HTMLFormElement>(
            'count-form'
          );

        if (!form.reportValidity()) {
          return;
        }

        count =
          Number(
            input(
              'team-count'
            ).value
          );

        invalidate();

        checks.forEach(check => {
          check.checked = false;
        });

        input(
          'team-search'
        ).value = '';

        filterTeams();
        updateSelection();

        show(
          'selection',
          'selection-heading'
        );
      }
    );

    /* TEAM EVENTS */

    checks.forEach(check =>
      check.addEventListener(
        'change',
        updateSelection
      )
    );

    input(
      'team-search'
    ).addEventListener(
      'input',
      filterTeams
    );

    button(
      'clear-teams'
    ).addEventListener(
      'click',
      () => {
        checks.forEach(check => {
          check.checked = false;
        });

        updateSelection();
      }
    );

    button(
      'change-count'
    ).addEventListener(
      'click',
      () => {
        invalidate();

        show(
          'count-form',
          'team-count'
        );
      }
    );

    button(
      'continue-settings'
    ).addEventListener(
      'click',
      () => {
        if (
          selected().length !== count
        ) {
          return;
        }

        element(
          'settings-summary'
        ).textContent =
          summary();

        show(
          'settings',
          'settings-heading'
        );
      }
    );

    button(
      'change-teams'
    ).addEventListener(
      'click',
      () => {
        invalidate();

        updateSelection();

        show(
          'selection',
          'selection-heading'
        );
      }
    );

    /* DATE */

    input(
      'start-date'
    ).addEventListener(
      'change',
      () => {
        const start =
          input('start-date');

        const end =
          input('end-date');

        end.min =
          start.value;

        if (
          !end.value ||
          end.value < start.value
        ) {
          end.value =
            start.value;
        }
      }
    );

    /* CONNECTOR LINES */

    const drawConnections = () => {
      const canvas =
        root.querySelector<HTMLElement>(
          '.draw-canvas'
        );

      const svg =
        canvas?.querySelector<SVGSVGElement>(
          'svg.draw-connectors'
        );

      if (!canvas || !svg) return;

      svg.replaceChildren();

      if (
        getComputedStyle(svg)
          .display === 'none'
      ) {
        return;
      }

      const bounds =
        canvas.getBoundingClientRect();

      svg.setAttribute(
        'viewBox',
        `0 0 ${bounds.width} ${bounds.height}`
      );

      const nodes =
        new Map(
          Array.from(
            canvas.querySelectorAll<HTMLElement>(
              '[data-match-number]'
            )
          ).map(node => [
            Number(
              node.dataset.matchNumber
            ),
            node
          ])
        );

      for (
        const entry of
          bracket?.draw ?? []
      ) {
        if (
          entry.roundId === 'bronze'
        ) {
          continue;
        }

        const target =
          nodes
            .get(entry.number)
            ?.getBoundingClientRect();

        if (!target) continue;

        for (
          const sourceNumber of [
            entry.source1,
            entry.source2
          ]
        ) {
          if (!sourceNumber) continue;

          const source =
            nodes
              .get(sourceNumber)
              ?.getBoundingClientRect();

          if (!source) continue;

          const x1 =
            source.right -
            bounds.left;

          const x2 =
            target.left -
            bounds.left;

          const y1 =
            source.top +
            source.height / 2 -
            bounds.top;

          const y2 =
            target.top +
            target.height / 2 -
            bounds.top;

          const middle =
            (x1 + x2) / 2;

          const path =
            document.createElementNS(
              'http://www.w3.org/2000/svg',
              'path'
            );

          path.setAttribute(
            'd',
            `M ${x1} ${y1} H ${middle} V ${y2} H ${x2}`
          );

          svg.append(path);
        }
      }
    };

    const scheduleConnections =
      () =>
        requestAnimationFrame(
          drawConnections
        );

    const resizeObserver =
      new ResizeObserver(
        scheduleConnections
      );

    resizeObserver.observe(
      element('draw-rounds')
    );

    document.fonts.ready.then(
      scheduleConnections
    );

    /* RENDER DRAW */

    const render = () => {
      if (!bracket) return;

      const rounds =
        element('draw-rounds');

      rounds.replaceChildren();

      const stage =
        bracket.tournament
          .data.stages[0];

      const mainRounds =
        stage.rounds.filter(
          round =>
            round.placement !== 3
        );

      const canvas =
        document.createElement('div');

      canvas.className =
        'draw-canvas';

      canvas.style.setProperty(
        '--round-count',
        String(mainRounds.length)
      );

      const rows =
        stage.rounds.some(
          round =>
            round.placement === 3
        )
          ? Math.max(
              stage.bracketSize + 1,
              stage.bracketSize / 2 + 7
            )
          : stage.bracketSize + 1;

      canvas.style.setProperty(
        '--bracket-rows',
        String(rows)
      );

      const svg =
        document.createElementNS(
          'http://www.w3.org/2000/svg',
          'svg'
        );

      svg.classList.add(
        'draw-connectors'
      );

      svg.setAttribute(
        'aria-hidden',
        'true'
      );

      canvas.append(svg);
      rounds.append(canvas);

      for (
        const [
          roundIndex,
          round
        ] of
          stage.rounds.entries()
      ) {
        const section =
          document.createElement(
            'section'
          );

        section.className =
          round.placement === 3
            ? 'draw-bronze'
            : 'draw-round';

        section.style.setProperty(
          '--round-column',
          String(roundIndex + 1)
        );

        if (
          round.placement === 3
        ) {
          section.style.gridColumn =
            String(
              mainRounds.length
            );

          section.style.gridRow =
            `${
              2 +
              stage.bracketSize / 2 +
              4
            } / span 3`;
        }

        const heading =
          document.createElement('h3');

        heading.textContent =
          round.name;

        section.append(heading);

        const list =
          document.createElement('ol');

        const entries =
          bracket.draw.filter(
            entry =>
              entry.roundId ===
              round.id
          );

        for (
          const entry of entries
        ) {
          const item =
            document.createElement('li');

          item.className =
            `draw-match ${
              entry.kind === 'bye'
                ? 'draw-bye'
                : ''
            }`;

          item.dataset.matchNumber =
            String(entry.number);

          if (
            round.placement !== 3
          ) {
            item.style.gridColumn =
              String(roundIndex + 1);

            item.style.gridRow =
              String(
                2 +
                (
                  2 *
                    entry.slot -
                  1
                ) *
                  2 **
                    roundIndex
              );
          }

          const title =
            document.createElement(
              'strong'
            );

          title.className =
            'draw-match-title';

          if (
            entry.kind === 'bye'
          ) {
            title.textContent =
              `Match ${entry.number} · BYE`;

            title.title =
              'Advances automatically';
          } else {
            title.textContent =
              `Match ${entry.number}`;
          }

          item.append(title);

          for (
            const side of [
              1,
              2
            ] as const
          ) {
            const row =
              document.createElement(
                'span'
              );

            row.className =
              'draw-team';

            const teamId =
              entry[`team${side}`];

            const source =
              entry[`source${side}`];

            const team =
              teamId
                ? teams.get(teamId)
                : undefined;

            if (
              entry.kind === 'bye' &&
              side === 2
            ) {
              row.classList.add(
                'bye-label'
              );

              const label =
                document.createElement(
                  'span'
                );

              label.textContent =
                'Advances automatically';

              row.append(label);
              item.append(row);

              continue;
            }

            const label =
              document.createElement(
                'span'
              );

            if (team) {
              label.textContent =
                team.name;
            } else if (source) {
              label.textContent =
                `${
                  round.placement === 3
                    ? 'Loser'
                    : 'Winner'
                } of Match ${source}`;
            } else {
              label.textContent =
                'TBD';
            }

            label.title =
              label.textContent;

            if (team) {
              row.classList.add(
                'known-team'
              );

              row.style.setProperty(
                '--team-color',
                team.color
              );

              const logo =
                document.createElement(
                  'img'
                );

              logo.className =
                'generator-team-logo';

              logo.src =
                team.logo;

              logo.alt = '';

              logo.width =
                logo.height =
                  32;

              logo.loading =
                'lazy';

              logo.onerror = () => {
                logo.onerror = null;
                logo.src =
                  '/logos/default.webp';
              };

              row.append(logo);
            } else if (source) {
              row.classList.add(
                'source-team'
              );
            }

            row.append(label);
            item.append(row);
          }

          list.append(item);
        }

        section.append(list);
        canvas.append(section);
      }

      element(
        'draw-summary'
      ).textContent =
        `${
          bracket.tournament.data.name
        } · ${summary()}`;

      element(
        'draw-status'
      ).textContent =
        `Draw ${generation}. Regenerate as often as needed before confirming.`;

      button(
        'regenerate'
      ).disabled =
        confirmed;

      button(
        'confirm-draw'
      ).disabled =
        confirmed;

      button(
        'edit-settings'
      ).disabled =
        confirmed;

      element(
        'export-controls'
      ).hidden =
        !confirmed;

      scheduleConnections();
    };

    /* GENERATE */

    const generate = () => {
      if (
        !options ||
        confirmed
      ) {
        return;
      }

      try {
        bracket =
          generateBracket(options);

        revision++;
        generation++;

        reportError('');

        render();

        show(
          'preview',
          'preview-heading'
        );

        scheduleConnections();
      } catch (cause) {
        reportError(
          cause instanceof Error
            ? cause.message
            : 'Could not generate the draw. Review the settings and try again.'
        );
      }
    };

    /* SETTINGS SUBMIT */

    element<HTMLFormElement>(
      'settings'
    ).addEventListener(
      'submit',
      event => {
        event.preventDefault();

        const form =
          element<HTMLFormElement>(
            'settings'
          );

        if (!form.reportValidity()) {
          return;
        }

        const tournamentName =
          input(
            'tournament-name'
          ).value.trim();

        const tournamentId =
          slugify(
            tournamentName
          );

        if (!tournamentId) {
          reportError(
            'Enter a valid tournament name.'
          );

          input(
            'tournament-name'
          ).focus();

          return;
        }

        if (
          catalog.tournamentIds.includes(
            tournamentId
          )
        ) {
          reportError(
            'A tournament with this name already exists. Use a different tournament name.'
          );

          input(
            'tournament-name'
          ).focus();

          return;
        }

        options = {
          teamCount: count,

          selectedTeamIds:
            selected(),

          availableTeamIds:
            Array.from(teams.keys()),
          teamNames: Object.fromEntries(Array.from(teams.values(),team=>[team.id,team.name])),

          tournamentId,

          name:
            tournamentName,

          startDate:
            input(
              'start-date'
            ).value,

          endDate:
            input(
              'end-date'
            ).value,

          mapCount:
            Number(
              input(
                'map-count'
              ).value
            ),

          thirdPlace:
            input(
              'third-place'
            ).checked,

          existingTournamentIds:
            catalog.tournamentIds,

          existingMatchIds:
            catalog.matchIds
        };

        generate();
      }
    );

    /* DRAW ACTIONS */

    button(
      'regenerate'
    ).addEventListener(
      'click',
      generate
    );

    button(
      'edit-settings'
    ).addEventListener(
      'click',
      () => {
        invalidate();

        show(
          'settings',
          'settings-heading'
        );
      }
    );

    /* CONFIRM */

    button(
      'confirm-draw'
    ).addEventListener(
      'click',
      () => {
        if (!bracket) return;

        confirmed = true;

        button(
          'regenerate'
        ).disabled = true;

        button(
          'confirm-draw'
        ).disabled = true;

        button(
          'edit-settings'
        ).disabled = true;

        exportJson =
          JSON.stringify(
            bracketExport(bracket, Array.from(customTeams.values()).filter(team => selected().includes(team.id))),
            null,
            2
          );

        element(
          'draw-status'
        ).textContent =
          `Draw ${generation} confirmed. Download or copy it below.`;

        element(
          'export-controls'
        ).hidden = false;

        button(
          'download-draw'
        ).focus();
      }
    );

    /* UNLOCK */

    button(
      'unlock-draw'
    ).addEventListener(
      'click',
      () => {
        confirmed = false;
        revision++;

        exportJson = '';

        element(
          'export-status'
        ).textContent = '';

        render();

        button(
          'regenerate'
        ).focus();
      }
    );

    const saveImage = (blob: Blob, filename: string) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const exportImage = async (copy: boolean) => {
      if (!confirmed || !bracket) return;
      const currentRevision = revision;
      const filename = `${bracket.tournament.id}-bracket.png`;
      const image = createBracketImage(bracket, teams);
      button('copy-draw').disabled = true;
      button('download-draw').disabled = true;
      element('export-status').textContent = copy ? 'Copying image…' : 'Preparing PNG…';
      try {
        if (copy && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
          try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
            if (confirmed && revision === currentRevision) element('export-status').textContent = 'Image copied. Paste it into your chat to share.';
            return;
          } catch {
            // A PNG download also works when image clipboard permission is unavailable.
          }
        }
        const blob = await image;
        if (!confirmed || revision !== currentRevision) return;
        saveImage(blob, filename);
        element('export-status').textContent = copy ? 'Image copy is unavailable. PNG downloaded for sharing.' : 'PNG download started.';
      } catch {
        if (revision === currentRevision) element('export-status').textContent = 'Could not create the image. Please try again.';
      } finally {
        button('copy-draw').disabled = false;
        button('download-draw').disabled = false;
      }
    };
    button('copy-draw').addEventListener('click', () => exportImage(true));
    button('download-draw').addEventListener('click', () => {
      if (!confirmed || !bracket) return;
      saveImage(new Blob([exportJson + '\n'], { type: 'application/json' }), `${bracket.tournament.id}-bracket.json`);
      element('export-status').textContent = 'JSON download started.';
    });

    /* INITIAL STATE */

    element(
      'generator-loading'
    ).hidden = true;

    const defaultCount = 8;

    input(
      'team-count'
    ).value =
      String(defaultCount);

    const defaultSize =
      bracketSizeFor(
        defaultCount
      );

    element(
      'count-summary'
    ).textContent =
      `${defaultSize} slots · ${
        defaultSize -
        defaultCount
      } BYEs`;

    sections.forEach(section => {
      element(section).hidden =
        section !==
        'count-form';
    });

  } catch (cause) {
    element(
      'generator-loading'
    ).hidden = true;

    console.error(
      'Bracket generator:',
      cause
    );

    reportError(
      'The generator could not load. Reload this page to try again.'
    );
  }
}