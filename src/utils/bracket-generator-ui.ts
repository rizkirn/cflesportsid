import { bracketSizeFor, generateBracket, bracketExport, type BracketOptions, type GeneratedBracket } from './bracket-generator';

export function initializeBracketGenerator() {
  const root = document.querySelector<HTMLElement>('.generator');
  if (!root) return;
  const element = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const input = (id: string) => element<HTMLInputElement>(id);
  const button = (id: string) => element<HTMLButtonElement>(id);
  const error = element('generator-error');
  const reportError = (message: string) => { error.textContent = message; error.hidden = !message; };
  try {
    const catalog = JSON.parse(root.dataset.catalog!) as { teams: { id: string; name: string; logo: string; color: string }[]; tournamentIds: string[]; matchIds: string[] };
    const teams = new Map(catalog.teams.map(team => [team.id, team]));
    const checks = Array.from(root.querySelectorAll<HTMLInputElement>('input[name="team"]'));
    const sections = ['count-form', 'selection', 'settings', 'preview'];
    let count = 0;
    let options: BracketOptions | undefined;
    let bracket: GeneratedBracket | undefined;
    let confirmed = false;
    let exportJson = '';
    let generation = 0;
    let revision = 0;
    const selected = () => checks.filter(check => check.checked).map(check => check.value);
    const summary = () => `${count} teams · ${bracketSizeFor(count)} slots · ${bracketSizeFor(count) - count} BYEs`;
    const show = (id: string, focusId: string) => {
      sections.forEach(section => { element(section).hidden = section !== id; });
      reportError('');
      element(focusId).focus();
    };
    const invalidate = () => {
      revision++;
      bracket = undefined;
      confirmed = false;
      generation = 0;
      element('export-controls').hidden = true;
      exportJson = '';
      element('export-status').textContent = '';
    };
    const updateSelection = () => {
      const total = selected().length;
      checks.forEach(check => { check.disabled = !check.checked && total >= count; });
      element('selection-status').textContent = `${total} / ${count} selected. ${total === count ? 'Ready to continue.' : `Choose ${count - total} more teams.`}`;
      button('continue-settings').disabled = total !== count;
      button('clear-teams').disabled = total === 0;
    };
    const filterTeams = () => {
      const query = input('team-search').value.trim().toLowerCase();
      const rows = Array.from(root.querySelectorAll<HTMLElement>('.team-option'));
      rows.forEach(row => { row.hidden = !row.dataset.search!.includes(query); });
      element('no-teams').hidden = rows.some(row => !row.hidden);
    };
    input('team-count').addEventListener('input', () => {
      const value = Number(input('team-count').value);
      element('count-summary').textContent = input('team-count').validity.valid
        ? `${bracketSizeFor(value)} slots · ${bracketSizeFor(value) - value} BYEs` : '';
    });
    element<HTMLFormElement>('count-form').addEventListener('submit', event => {
      event.preventDefault();
      count = Number(input('team-count').value);
      invalidate();
      checks.forEach(check => { check.checked = false; });
      input('team-search').value = '';
      filterTeams();
      updateSelection();
      show('selection', 'selection-heading');
    });
    checks.forEach(check => check.addEventListener('change', updateSelection));
    input('team-search').addEventListener('input', filterTeams);
    button('clear-teams').addEventListener('click', () => { checks.forEach(check => { check.checked = false; }); updateSelection(); });
    button('change-count').addEventListener('click', () => { invalidate(); show('count-form', 'team-count'); });
    button('continue-settings').addEventListener('click', () => {
      element('settings-summary').textContent = summary();
      show('settings', 'settings-heading');
    });
    button('change-teams').addEventListener('click', () => { invalidate(); show('selection', 'selection-heading'); });
    input('start-date').addEventListener('change', () => {
      input('end-date').min = input('start-date').value;
      if (!input('end-date').value) input('end-date').value = input('start-date').value;
    });
    const drawConnections = () => {
      const canvas = root.querySelector<HTMLElement>('.draw-canvas');
      const svg = canvas?.querySelector<SVGSVGElement>('svg');
      if (!canvas || !svg) return;
      svg.replaceChildren();
      if (getComputedStyle(svg).display === 'none') return;
      const bounds = canvas.getBoundingClientRect();
      svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
      const nodes = new Map(Array.from(canvas.querySelectorAll<HTMLElement>('[data-match-number]')).map(node => [Number(node.dataset.matchNumber), node]));
      for (const entry of bracket?.draw ?? []) {
        if (entry.roundId === 'bronze') continue;
        const target = nodes.get(entry.number)?.getBoundingClientRect();
        if (!target) continue;
        for (const sourceNumber of [entry.source1, entry.source2]) {
          const source = sourceNumber && nodes.get(sourceNumber)?.getBoundingClientRect();
          if (!source) continue;
          const x1 = source.right - bounds.left;
          const x2 = target.left - bounds.left;
          const y1 = source.top + source.height / 2 - bounds.top;
          const y2 = target.top + target.height / 2 - bounds.top;
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', `M ${x1} ${y1} H ${(x1 + x2) / 2} V ${y2} H ${x2}`);
          svg.append(path);
        }
      }
    };
    const scheduleConnections = () => requestAnimationFrame(drawConnections);
    new ResizeObserver(scheduleConnections).observe(element('draw-rounds'));
    document.fonts.ready.then(scheduleConnections);
    const render = () => {
      if (!bracket) return;
      const rounds = element('draw-rounds');
      rounds.replaceChildren();
      const stage = bracket.tournament.data.stages[0];
      const mainRounds = stage.rounds.filter(round => round.placement !== 3);
      const canvas = document.createElement('div');
      canvas.className = 'draw-canvas';
      canvas.style.setProperty('--round-count', String(mainRounds.length));
      const rows = stage.rounds.some(round => round.placement === 3)
        ? Math.max(stage.bracketSize + 1, stage.bracketSize / 2 + 7)
        : stage.bracketSize + 1;
      canvas.style.setProperty('--bracket-rows', String(rows));
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('draw-connectors');
      svg.setAttribute('aria-hidden', 'true');
      canvas.append(svg);
      rounds.append(canvas);
      for (const [roundIndex, round] of stage.rounds.entries()) {
        const section = document.createElement('section');
        section.className = round.placement === 3 ? 'draw-bronze' : 'draw-round';
        section.style.setProperty('--round-column', String(roundIndex + 1));
        if (round.placement === 3) {
          section.style.gridColumn = String(mainRounds.length);
          section.style.gridRow = `${2 + stage.bracketSize / 2 + 4} / span 3`;
        }
        const heading = document.createElement('h3');
        heading.textContent = round.name;
        section.append(heading);
        const list = document.createElement('ol');
        for (const entry of bracket.draw.filter(entry => entry.roundId === round.id)) {
          const item = document.createElement('li');
          item.className = `draw-match ${entry.kind === 'bye' ? 'draw-bye' : ''}`;
          item.dataset.matchNumber = String(entry.number);
          if (round.placement !== 3) {
            item.style.gridColumn = String(roundIndex + 1);
            item.style.gridRow = String(2 + (2 * entry.slot - 1) * 2 ** roundIndex);
          }
          const title = document.createElement('strong');
          title.textContent = `Match ${entry.number}${entry.kind === 'bye' ? ' · BYE' : ''}`;
          title.title = entry.kind === 'bye' ? 'Advances automatically' : `Match ${entry.number}`;
          item.append(title);
          for (const side of [1, 2] as const) {
            const row = document.createElement('span');
            row.className = 'draw-team';
            const teamId = entry[`team${side}`];
            const source = entry[`source${side}`];
            const team = teamId ? teams.get(teamId) : undefined;
            const label = document.createElement('span');
            label.textContent = team ? team.name : source
              ? `${round.placement === 3 ? 'Loser' : 'Winner'} of Match ${source}` : 'BYE';
            label.title = source && teamId ? `${label.textContent} (BYE from Match ${source})` : label.textContent;
            if (team) {
              row.classList.add('known-team');
              row.style.setProperty('--team-color', team.color);
              const logo = document.createElement('img');
              logo.className = 'generator-team-logo';
              logo.src = team.logo;
              logo.alt = '';
              logo.width = logo.height = 32;
              logo.loading = 'lazy';
              logo.onerror = () => { logo.onerror = null; logo.src = '/logos/default.webp'; };
              row.append(logo);
            }
            row.append(label);
            item.append(row);
          }
          list.append(item);
        }
        section.append(list);
        canvas.append(section);
      }
      element('draw-summary').textContent = `${bracket.tournament.data.name} · ${summary()}`;
      element('draw-status').textContent = `Draw ${generation}. Regenerate as often as needed before confirming.`;
      button('regenerate').disabled = false;
      button('confirm-draw').disabled = false;
      button('edit-settings').disabled = false;
      element('export-controls').hidden = true;
      scheduleConnections();
    };
    const generate = () => {
      if (!options || confirmed) return;
      try {
        const next = generateBracket(options);
        bracket = next;
        revision++;
        generation++;
        reportError('');
        render();
        show('preview', 'preview-heading');
      } catch (cause) {
        reportError(cause instanceof Error ? cause.message : 'Could not generate the draw. Review the settings and try again.');
      }
    };
    element<HTMLFormElement>('settings').addEventListener('submit', event => {
      event.preventDefault();
      options = {
        teamCount: count, selectedTeamIds: selected(), availableTeamIds: catalog.teams.map(team => team.id),
        tournamentId: input('tournament-id').value.trim(), name: input('tournament-name').value,
        startDate: input('start-date').value, endDate: input('end-date').value,
        mapCount: Number(input('map-count').value), thirdPlace: input('third-place').checked,
        existingTournamentIds: catalog.tournamentIds, existingMatchIds: catalog.matchIds,
      };
      generate();
    });
    button('regenerate').addEventListener('click', generate);
    button('edit-settings').addEventListener('click', () => { invalidate(); show('settings', 'settings-heading'); });
    button('confirm-draw').addEventListener('click', () => {
      if (!bracket) return;
      confirmed = true;
      button('regenerate').disabled = true;
      button('confirm-draw').disabled = true;
      button('edit-settings').disabled = true;
      exportJson = JSON.stringify(bracketExport(bracket), null, 2);
      element('draw-status').textContent = `Draw ${generation} confirmed. Download or copy it below.`;
      element('export-controls').hidden = false;
      button('download-draw').focus();
    });
    button('unlock-draw').addEventListener('click', () => {
      confirmed = false;
      revision++;
      element('export-status').textContent = '';
      exportJson = '';
      render();
      button('regenerate').focus();
    });
    button('copy-draw').addEventListener('click', async () => {
      if (!confirmed) return;
      const currentRevision = revision;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      element('export-status').textContent = 'Copying JSON…';
      try {
        await Promise.race([
          navigator.clipboard.writeText(exportJson),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Clipboard unavailable')), 2500); }),
        ]);
        if (confirmed && revision === currentRevision) element('export-status').textContent = 'JSON copied.';
      } catch {
        if (!confirmed || revision !== currentRevision) return;
        element('export-status').textContent = 'Clipboard access was unavailable. Use Download to save the draw.';
      } finally {
        clearTimeout(timeout);
      }
    });
    button('download-draw').addEventListener('click', () => {
      if (!confirmed || !bracket) return;
      const url = URL.createObjectURL(new Blob([exportJson + '\n'], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${bracket.tournament.id}-bracket.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      element('export-status').textContent = 'JSON download started.';
    });
    element('generator-loading').hidden = true;
    if (catalog.teams.length < 5) reportError('Add at least 5 teams to the Teams collection before generating a bracket.');
    else element('count-form').hidden = false;
  } catch {
    element('generator-loading').hidden = true;
    reportError('The generator could not load. Reload this page to try again.');
  }
}
