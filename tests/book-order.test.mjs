import test from 'node:test';
import assert from 'node:assert/strict';
import { compareBookUpdates } from '../src/lib/book-order.ts';
const book=(id,updatedAt,addedAt='2020-01-01')=>({id,data:{updatedAt,addedAt}});

test('updated date outranks added date and ID across years and months',()=>{
  const books=[book('a','2025-12-31','2025-12-31'),book('z','2026-11-01'),book('b','2026-10-28','2026-10-28')];
  assert.deepEqual(books.toSorted(compareBookUpdates).map((b)=>b.id),['z','b','a']);
});
test('equal updates retain newest additions first, then stable ascending IDs',()=>{
  const books=[book('z','2026-10-28','2026-10-28'),book('old','2026-10-28'),book('a','2026-10-28','2026-10-28')];
  assert.deepEqual(books.toSorted(compareBookUpdates).map((b)=>b.id),['a','z','old']);
  assert.deepEqual(books.toReversed().toSorted(compareBookUpdates).map((b)=>b.id),['a','z','old']);
  assert.equal(compareBookUpdates(books[0],books[0]),0);
});
