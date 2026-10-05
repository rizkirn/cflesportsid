const entity = '[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?';
const file = '[a-f0-9]{64}\\.(?:webp|png|jpe?g)';
const shapes = {
  teams: new RegExp(`^teams/${entity}/logo/${file}$`),
  players: new RegExp(`^players/[0-9]{1,20}/avatar/${file}$`),
  maps: new RegExp(`^maps/${entity}/cover/${file}$`),
  tournaments: new RegExp(`^tournaments/${entity}/poster/${file}$`),
};
export function validAssetKey(key, category) {
  return typeof key === 'string' && Boolean(category ? shapes[category]?.test(key) : Object.values(shapes).some(shape => shape.test(key)));
}
export function assetMediaPath(key, category) {
  return validAssetKey(key, category) ? `/media/${key.split('/').map(encodeURIComponent).join('/')}` : null;
}
