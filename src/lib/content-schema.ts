import { z } from 'zod';
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
}, 'Use a real ISO calendar date (YYYY-MM-DD).');
const url = z.url().refine((value) => value.startsWith('https://'), 'Use an HTTPS URL.');
export const bookSchema = z.object({
  title: z.string().min(1),
  contributors: z.array(z.object({name:z.string().min(1),role:z.string().min(1)}).strict()).min(1),
  summary:z.string().min(1),
  cover:z.string().refine((value) => {
    try { const parsed=new URL(value,'https://epub.tw');return (value.startsWith('/images/covers/') || value.startsWith('https://')) && /\.(png|jpe?g)$/i.test(parsed.pathname); } catch { return false; }
  },'Use a local cover path or HTTPS PNG/JPEG URL.').optional(),
  category:z.enum(['biography','history','society','technology']),
  publishedAt:date.optional(),addedAt:date,updatedAt:date,sourceUrl:url,
  acquisition:z.array(z.object({type:z.enum(['direct','web']),url,label:z.string().min(1)}).strict()).min(1),
  license:z.object({
    name:z.string().regex(/^CC(?: |0)/),
    url:url.refine((value)=>/^https:\/\/creativecommons\.org\/(?:licenses\/(?:by|by-sa|by-nd|by-nc|by-nc-sa|by-nc-nd)\/(?:(?:1\.0|2\.0|2\.5|3\.0)\/(?:[a-z]{2}\/)?|4\.0\/)|publicdomain\/zero\/1\.0\/)$/.test(value),'Use the official Creative Commons license URL.'),
    evidenceUrl:url.optional(),
  }).strict(),
  language:z.string().min(2),readingUrl:url.optional(),
}).strict().refine((book)=>book.updatedAt>=book.addedAt,'updatedAt cannot precede addedAt.');
