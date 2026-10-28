import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'zod';
import { bookSchema,date } from './lib/content-schema';
export const collections={
  books:defineCollection({loader:glob({pattern:'*.md',base:'./src/content/books'}),schema:bookSchema}),
  posts:defineCollection({loader:glob({pattern:'*.md',base:'./src/content/posts'}),schema:z.object({title:z.string().min(1),author:z.string().min(1),publishedAt:date,updatedAt:date.optional()}).strict()}),
};
