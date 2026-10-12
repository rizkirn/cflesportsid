import type {APIRoute} from 'astro';
import {localD1Snapshot} from '../data-access/frontend-public';
import {publicSitemapResponse} from '../data-access/public-mode.mjs';
import {PublicDataError, publicErrorResponse} from '../data-access/public-d1.mjs';

export const prerender = false;
export const GET: APIRoute = () => {
  const snapshot = localD1Snapshot();
  return snapshot ? publicSitemapResponse(snapshot, true) : publicErrorResponse(new PublicDataError('MISSING_BINDING'));
};
