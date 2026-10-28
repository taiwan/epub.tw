import type { APIRoute } from 'astro';
import { categories, getBooks } from '../lib/catalog';
import { NAVIGATION_TYPE, renderNavigationFeed } from '../lib/opds';

export const prerender = true;

export const GET: APIRoute = async () => new Response(
  renderNavigationFeed(await getBooks(), categories),
  { headers: { 'Content-Type': `${NAVIGATION_TYPE};charset=utf-8` } },
);
