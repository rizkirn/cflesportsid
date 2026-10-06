import type { APIRoute } from 'astro';
import { serveFrontendMedia } from '../../data-access/frontend-media';

export const prerender = false;
export const ALL: APIRoute = ({ request }) => serveFrontendMedia(request);
