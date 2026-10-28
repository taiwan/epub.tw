import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// No runtime Astro dependency; supports Node versions before native TS stripping.
const source = await readFile(new URL('../src/lib/opds.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ES2022 },
});
const { renderNavigationFeed, renderAcquisitionFeed, escapeXml, NAVIGATION_TYPE, ACQUISITION_TYPE, CATALOG_UPDATED } =
  await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const categories = { biography: '人物傳記', history: '歷史', society: '社會', technology: '科技' };
const book = (id = 'example', overrides = {}) => ({
  id,
  body: 'Long description: A & B <notes>.',
  data: {
    title: 'A & B <book>',
    contributors: [{ name: 'Author & Co.', role: '作者' }, { name: 'Translator', role: '翻譯' }],
    summary: 'A <careful> summary & more.',
    category: 'society',
    addedAt: '2017-01-17',
    updatedAt: '2020-01-02',
    sourceUrl: 'https://example.org/book',
    acquisition: [{ type: 'direct', url: 'https://example.org/book.epub?one=1&two=2', label: '下載 EPUB' }],
    license: { name: 'CC BY-NC-SA 3.0 TW', url: 'https://creativecommons.org/licenses/by-nc-sa/3.0/tw/', evidenceUrl: 'https://example.org/license' },
    language: 'zh-Hant',
    ...overrides,
  },
});

test('navigation preserves four legacy category routes and identifies acquisition feeds', () => {
  const xml = renderNavigationFeed([book()], categories);
  assert.equal((xml.match(/<entry>/g) ?? []).length, 4);
  assert.ok(xml.includes(`type="${NAVIGATION_TYPE}"`));
  for (const category of Object.keys(categories)) {
    assert.ok(xml.includes(`href="https://epub.tw/categories/${category}.xml" type="${ACQUISITION_TYPE}"`));
  }
  assert.ok(!xml.includes('http://opds-spec.org/acquisition"'));
});

test('acquisition IDs are site-owned and independent of source or download URL', () => {
  const original = renderAcquisitionFeed('society', categories.society, [book()]);
  const moved = renderAcquisitionFeed('society', categories.society, [book('example', { sourceUrl: 'https://new.example/book', acquisition: [{ type: 'direct', url: 'https://new.example/book.epub', label: '下載 EPUB' }] })]);
  const getEntryId = (xml) => xml.match(/<entry>\s*<id>(.*?)<\/id>/)?.[1];
  assert.equal(getEntryId(original), 'https://epub.tw/books/example/');
  assert.equal(getEntryId(moved), getEntryId(original));
});

test('direct EPUB links have correct MIME, escaped URLs, and no unconditional-access claim', () => {
  const xml = renderAcquisitionFeed('society', categories.society, [book()]);
  assert.ok(xml.includes('href="https://example.org/book.epub?one=1&amp;two=2" type="application/epub+zip"'));
  assert.ok(!xml.includes('/acquisition/open-access'));
  assert.ok(!xml.includes('<opds:indirectAcquisition'));
});

test('Gumroad is an HTML intermediary with EPUB indirect acquisition, not a file or buy claim', () => {
  const xml = renderAcquisitionFeed('society', categories.society, [book('young-power', {
    acquisition: [{ type: 'web', url: 'https://locus.gumroad.com/l/youngp', label: '前往 Gumroad 取得 EPUB' }],
  })]);
  assert.ok(xml.includes('rel="http://opds-spec.org/acquisition" href="https://locus.gumroad.com/l/youngp" type="text/html"'));
  assert.ok(xml.includes('<opds:indirectAcquisition type="application/epub+zip"/>'));
  assert.ok(!xml.includes('/acquisition/buy'));
  assert.ok(!xml.includes('/acquisition/open-access'));
  assert.ok(!xml.includes('<opds:price'));
});

test('dates distinguish entry creation, maintained update, and book publication without build churn', () => {
  const xml = renderAcquisitionFeed('society', categories.society, [book('dated', { publishedAt: '2015-03-04' })]);
  assert.ok(xml.includes('<published>2017-01-17T00:00:00Z</published>'));
  assert.ok(xml.includes('<updated>2020-01-02T00:00:00Z</updated>'));
  assert.ok(xml.includes('<dc:issued>2015-03-04</dc:issued>'));
  assert.ok(!renderAcquisitionFeed('society', categories.society, [book()]).includes('<dc:issued>'));
  assert.equal(xml, renderAcquisitionFeed('society', categories.society, [book('dated', { publishedAt: '2015-03-04' })]));
});

test('empty covers emit no image link; JPG and PNG covers have their correct MIME types', () => {
  const absent = renderAcquisitionFeed('society', categories.society, [book()]);
  assert.ok(!absent.includes('http://opds-spec.org/image'));
  for (const [cover, mime] of [['/images/cover.jpg', 'image/jpeg'], ['/images/cover.png', 'image/png']]) {
    const xml = renderAcquisitionFeed('society', categories.society, [book('cover', { cover })]);
    assert.ok(xml.includes(`href="https://epub.tw${cover}" type="${mime}"`));
    assert.equal((xml.match(/http:\/\/opds-spec.org\/image/g) ?? []).length, 1);
  }
  assert.throws(() => renderAcquisitionFeed('society', categories.society, [book('bad', { cover: '/cover.webp' })]), /Unsupported OPDS cover/);
});

test('XML escaping preserves exact contributor names and roles', () => {
  const xml = renderAcquisitionFeed('society', categories.society, [book()]);
  assert.ok(xml.includes('<title>A &amp; B &lt;book&gt;</title>'));
  assert.ok(xml.includes('<summary type="text">A &lt;careful&gt; summary &amp; more.</summary>'));
  assert.ok(xml.includes('<author><name>Author &amp; Co.</name><epubtw:role>作者</epubtw:role></author>'));
  assert.ok(xml.includes('<contributor><name>Translator</name><epubtw:role>翻譯</epubtw:role></contributor>'));
  assert.equal(escapeXml('&<>"\''), '&amp;&lt;&gt;&quot;&apos;');
  assert.throws(() => escapeXml('\u0000'), /XML 1.0/);
});

test('empty categories retain the explicit catalog-revision date and navigation links', () => {
  const xml = renderAcquisitionFeed('history', categories.history, [book()]);
  assert.ok(xml.includes('<feed '));
  assert.ok(xml.includes(`<updated>${CATALOG_UPDATED}T00:00:00Z</updated>`));
  assert.ok(!xml.includes('<entry>'));
  assert.ok(xml.includes('rel="start"'));
  assert.ok(xml.includes('rel="up"'));
});

test('category feeds filter and sort by addedAt newest first with stable ties', () => {
  const books = [book('old'), book('new-b', { addedAt: '2025-01-01' }), book('other', { category: 'history' }), book('new-a', { addedAt: '2025-01-01' })];
  const xml = renderAcquisitionFeed('society', categories.society, books);
  const ids = [...xml.matchAll(/<entry>\s*<id>(.*?)<\/id>/g)].map((match) => match[1]);
  assert.deepEqual(ids, ['https://epub.tw/books/new-a/', 'https://epub.tw/books/new-b/', 'https://epub.tw/books/old/']);
  assert.equal(books[0].id, 'old', 'sorting must not mutate content input');
});

test('future metadata updates advance a feed beyond the maintained catalog revision', () => {
  const xml = renderAcquisitionFeed('society', categories.society, [book('future', { updatedAt: '2027-01-02' })]);
  assert.equal(xml.match(/<updated>(.*?)<\/updated>/)?.[1], '2027-01-02T00:00:00Z');
  assert.equal(renderNavigationFeed([book('future', { updatedAt: '2027-01-02' })], categories).match(/<updated>(.*?)<\/updated>/)?.[1], '2027-01-02T00:00:00Z');
});
