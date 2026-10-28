import type { APIRoute, GetStaticPaths } from 'astro';
import { categories, getBooks } from '../../lib/catalog';
import { ACQUISITION_TYPE, renderAcquisitionFeed } from '../../lib/opds';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = () => Object.entries(categories).map(([category, label]) => ({
  params: { category },
  props: { label },
}));

export const GET: APIRoute = async ({ params, props }) => new Response(
  renderAcquisitionFeed(params.category!, props.label, await getBooks()),
  { headers: { 'Content-Type': `${ACQUISITION_TYPE};charset=utf-8` } },
);
