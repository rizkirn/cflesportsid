import type { CollectionEntry } from 'astro:content';

export function resolveVeto(
  stage: Pick<
    CollectionEntry<'tournaments'>['data']['stages'][number],
    'series' | 'veto'
  >,
  maps: Map<string, CollectionEntry<'maps'>>
) {
  const config = stage.veto;

  if (!config) return undefined;

  if (
    stage.series.type !== 'fixed-maps' ||
    stage.series.mapCount !== 3
  ) {
    throw new Error(
      'Veto supports fixed three-map stages only.'
    );
  }

  /*
   * All active maps automatically become
   * part of the current veto pool.
   */
  const pool = [...maps.values()]
    .filter(map => map.data.active)
    .map(map => ({
      id: map.id,
      name: map.data.name
    }))
    .sort((a, b) =>
      a.name.localeCompare(b.name)
    );

  /*
   * Each team must pick exactly one map.
   */
  for (const team of ['A', 'B'] as const) {
    const picks = config.steps.filter(
      step =>
        step.team === team &&
        step.action === 'pick'
    ).length;

    if (picks !== 1) {
      throw new Error(
        'Each team must have exactly one map pick.'
      );
    }
  }

  /*
   * At least one map must remain after
   * all ban/pick actions for Map 3.
   */
  if (config.steps.length >= pool.length) {
    throw new Error(
      `Veto must leave at least one map for the wheel. steps=${config.steps.length} pool=${pool.length} poolIds=${JSON.stringify(pool.map(p=>p.id))}`
    );
  }

  return {
    steps: config.steps,
    finalMap: config.finalMap,
    actionSeconds: config.actionSeconds,
    reserveSeconds: config.reserveSeconds,
    maps: pool
  };
}
