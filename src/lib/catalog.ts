import { getCollection } from 'astro:content';
export const categories={biography:'人物傳記',history:'歷史',society:'社會',technology:'科技'} as const;
export async function getBooks(){return (await getCollection('books')).sort((a,b)=>b.data.addedAt.localeCompare(a.data.addedAt)||a.id.localeCompare(b.id,'en'));}
export async function getPosts(){return (await getCollection('posts')).sort((a,b)=>b.data.publishedAt.localeCompare(a.data.publishedAt)||a.id.localeCompare(b.id,'en'));}
export const formatDate=(value:string)=>value.replaceAll('-','.');
