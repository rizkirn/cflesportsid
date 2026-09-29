export function randomizeMaps<T>(maps: readonly T[], rounds: number, random = Math.random): T[] {
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > maps.length) {
    throw new RangeError('Rounds must be between 1 and the number of available maps.');
  }
  const pool = [...maps];
  for (let index = pool.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [pool[index], pool[target]] = [pool[target], pool[index]];
  }
  return pool.slice(0, rounds);
}
