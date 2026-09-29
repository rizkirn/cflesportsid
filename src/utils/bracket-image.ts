import type { GeneratedBracket } from './bracket-generator';

type Team = { name: string; color: string; logo: string };

function loadLogo(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const image = new Image();
    const timer = setTimeout(() => resolve(null), 5000);
    image.crossOrigin = 'anonymous';
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); resolve(null); };
    image.src = src;
  });
}

export async function createBracketImage(bracket: GeneratedBracket, teams: Map<string, Team>): Promise<Blob> {
  const teamIds = [...new Set(bracket.draw.flatMap(entry => [entry.team1, entry.team2]).filter((id): id is string => Boolean(id)))];
  const fallback = await loadLogo('/logos/default.webp');
  const logos = new Map(await Promise.all(teamIds.map(async id => {
    const team = teams.get(id);
    return [id, team ? (await loadLogo(team.logo)) ?? fallback : null] as const;
  })));
  const stage = bracket.tournament.data.stages[0];
  const rounds = stage.rounds.filter(round => round.placement !== 3);
  const width = 80 + rounds.length * 320;
  const height = 240 + stage.bracketSize / 2 * 130 + 200;
  const canvas = document.createElement('canvas');
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image rendering is unavailable.');
  ctx.scale(2, 2);
  ctx.fillStyle = '#090a0c';
  ctx.fillRect(0, 0, width, height);
  const text = (value: string, x: number, y: number, size = 18, color = '#f4f3ef', max = 280) => {
    ctx.fillStyle = color;
    ctx.font = `${size >= 22 ? 'bold ' : ''}${size}px Arial`;
    ctx.fillText(value, x, y, max);
  };
  text('CFL ESPORTS INDONESIA', 40, 48, 18, '#ff742e', width - 80);
  text(bracket.tournament.data.name, 40, 90, 30, '#f4f3ef', width - 80);
  text('TOURNAMENT BRACKET', 40, 120, 14, '#a4a6ac');
  const positions = new Map<number, { x: number; y: number }>();
  for (const entry of bracket.draw) {
    const roundIndex = rounds.findIndex(round => round.id === entry.roundId);
    const bronze = roundIndex < 0;
    positions.set(entry.number, {
      x: 40 + (bronze ? rounds.length - 1 : roundIndex) * 320,
      y: bronze ? height - 180 : 190 + ((entry.slot - .5) * 2 ** roundIndex - .5) * 130
    });
  }
  ctx.strokeStyle = '#555963';
  ctx.lineWidth = 2;
  for (const entry of bracket.draw) {
    if (!rounds.some(round => round.id === entry.roundId)) continue;
    const end = positions.get(entry.number)!;
    for (const source of [entry.source1, entry.source2]) {
      const start = source && positions.get(source);
      if (!start) continue;
      ctx.beginPath(); ctx.moveTo(start.x + 280, start.y + 48);
      ctx.lineTo(end.x - 20, start.y + 48); ctx.lineTo(end.x - 20, end.y + 48);
      ctx.lineTo(end.x, end.y + 48); ctx.stroke();
    }
  }
  rounds.forEach((round, index) => text(round.name.toUpperCase(), 40 + index * 320, 166, 18, '#ff742e'));
  for (const entry of bracket.draw) {
    const { x, y } = positions.get(entry.number)!;
    const bronze = !rounds.some(round => round.id === entry.roundId);
    if (bronze) text('THIRD PLACE', x, y - 16, 18, '#ff742e');
    ctx.fillStyle = '#111215'; ctx.fillRect(x, y, 280, 100);
    ctx.strokeStyle = '#303137'; ctx.strokeRect(x, y, 280, 100);
    text(`Match ${entry.number}${entry.kind === 'bye' ? ' · BYE' : ''}`, x + 12, y + 20, 12, '#a4a6ac');
    for (const side of [1, 2] as const) {
      const id = entry[`team${side}`];
      const team = id ? teams.get(id) : undefined;
      const source = entry[`source${side}`];
      const label = entry.kind === 'bye' && side === 2 ? 'Advances automatically' : team?.name ?? (source ? `${bronze ? 'Loser' : 'Winner'} of Match ${source}` : 'TBD');
      ctx.fillStyle = team?.color ?? '#303137'; ctx.fillRect(x, y + 28 + (side - 1) * 34, 3, 34);
      const logo = id ? logos.get(id) : null;
      if (logo) {
        const ratio = Math.min(26 / logo.naturalWidth, 26 / logo.naturalHeight);
        const w = logo.naturalWidth * ratio;
        const h = logo.naturalHeight * ratio;
        ctx.drawImage(logo, x + 12 + (26 - w) / 2, y + 32 + (side - 1) * 34 + (26 - h) / 2, w, h);
      }
      text(label, x + (team ? 46 : 12), y + 51 + (side - 1) * 34, 17, team ? '#f4f3ef' : '#a4a6ac', team ? 222 : 256);
    }
  }
  text('Generated with CFL Esports Indonesia', 40, height - 28, 14, '#a4a6ac');
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create image.')), 'image/png'));
}
