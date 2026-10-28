#!/usr/bin/env node
// Usage: node tests/validate-opds.mjs [dist] [optional-reference-dist]
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SaxesParser } from 'saxes';

const ATOM = 'http://www.w3.org/2005/Atom';
const OPDS = 'http://opds-spec.org/2010/catalog';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const CATEGORIES = ['biography', 'history', 'society', 'technology'];
const NAV = 'application/atom+xml;profile=opds-catalog;kind=navigation';
const ACQ = 'application/atom+xml;profile=opds-catalog;kind=acquisition';
const EPUB = 'application/epub+zip';
const DATE = /^\d{4}-\d{2}-\d{2}T00:00:00Z$/;
const expandedName = (uri, local) => uri ? `{${uri}}${local}` : local;

// Use a strict XML parser, not HTML parsing or regular-expression matching.
// Namespace declarations and prefix choices do not affect semantic comparison.
// DTDs are not needed by OPDS; reject them without fetching external resources.
export function parseXml(xml, fileName = 'XML') {
  if (Buffer.isBuffer(xml)) xml = new TextDecoder('utf-8', { fatal: true }).decode(xml);
  const parser = new SaxesParser({ xmlns: true, fileName });
  const stack = [];
  let root;
  parser.on('doctype', () => { throw new Error(`${fileName}: DTDs are not allowed`); });
  parser.on('opentag', (tag) => {
    const node = {
      tag: expandedName(tag.uri, tag.local),
      attributes: Object.fromEntries(Object.values(tag.attributes)
        .filter((attribute) => attribute.uri !== XMLNS)
        .map((attribute) => [expandedName(attribute.uri, attribute.local), attribute.value])),
      text: '', tail: '', children: [],
    };
    if (stack.length) stack.at(-1).children.push(node);
    else root = node;
    stack.push(node);
  });
  const appendText = (value) => {
    const parent = stack.at(-1);
    if (!parent) return;
    if (parent.children.length) parent.children.at(-1).tail += value;
    else parent.text += value;
  };
  parser.on('text', appendText);
  parser.on('cdata', appendText);
  parser.on('closetag', () => { stack.pop(); });
  parser.write(xml).close(); // Saxes throws on all well-formedness errors.
  assert.ok(root, `${fileName}: missing document element`);
  return root;
}

const children = (element, name, namespace = ATOM) =>
  element.children.filter((child) => child.tag === expandedName(namespace, name));
const first = (element, name, namespace = ATOM) => children(element, name, namespace)[0];
const links = (element, rel) => children(element, 'link').filter((link) => link.attributes.rel === rel);
const text = (element, name) => {
  const value = first(element, name)?.text;
  assert.ok(value, `Missing ${name}`);
  return value;
};
const hasAuthor = (element) => children(element, 'author').some((author) => first(author, 'name'));
const trimWhitespace = (value) => value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
const structure = (element) => [
  element.tag, Object.entries(element.attributes).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
  trimWhitespace(element.text), trimWhitespace(element.tail), element.children.map(structure),
];
const validDate = (value) => DATE.test(value) && !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString() === value.replace('Z', '.000Z');
const isFile = (path) => statSync(path, { throwIfNoEntry: false })?.isFile() === true;
const localUrlPath = (dist, url) => {
  const path = resolve(dist, `.${decodeURIComponent(new URL(url).pathname)}`);
  assert.ok(path.startsWith(`${resolve(dist)}${sep}`), `Path outside build: ${url}`);
  return path;
};

export function validateOpds(dist = 'dist', reference) {
  const loadFeed = (path, kind) => {
    const root = parseXml(readFileSync(resolve(dist, path)), path);
    assert.equal(root.tag, expandedName(ATOM, 'feed'), path);
    assert.equal(text(root, 'id'), `https://epub.tw/${path}`);
    assert.ok(validDate(text(root, 'updated')), path);
    text(root, 'title');
    assert.equal(links(root, 'self').length, 1);
    assert.equal(links(root, 'self')[0].attributes.type, kind);
    assert.deepEqual(links(root, 'start')[0]?.attributes, {
      rel: 'start', href: 'https://epub.tw/opds.xml', type: NAV,
    });
    assert.ok(hasAuthor(root), `Missing feed author: ${path}`);
    if (reference) {
      const expected = parseXml(readFileSync(resolve(reference, path)), path);
      assert.deepEqual(structure(root), structure(expected), `Preview parity failed: ${path}`);
    }
    return root;
  };

  const root = loadFeed('opds.xml', NAV);
  const rootEntries = children(root, 'entry');
  assert.equal(rootEntries.length, CATEGORIES.length);
  const expectedRoutes = new Set(CATEGORIES.map((category) => `https://epub.tw/categories/${category}.xml`));
  const actualRoutes = new Set();
  for (const entry of rootEntries) {
    text(entry, 'id');
    text(entry, 'title');
    assert.ok(validDate(text(entry, 'updated')));
    const subsection = links(entry, 'subsection');
    assert.equal(subsection.length, 1);
    assert.equal(subsection[0].attributes.type, ACQ);
    actualRoutes.add(subsection[0].attributes.href);
  }
  assert.deepEqual(actualRoutes, expectedRoutes);

  const allBookIds = new Set();
  let acquisitionCount = 0;
  let webAcquisitionCount = 0;
  let imageCount = 0;
  for (const category of CATEGORIES) {
    const feed = loadFeed(`categories/${category}.xml`, ACQ);
    assert.equal(links(feed, 'up')[0]?.attributes.href, 'https://epub.tw/opds.xml');
    const addedDates = [];
    for (const entry of children(feed, 'entry')) {
      const entryId = text(entry, 'id');
      assert.ok(entryId.startsWith('https://epub.tw/books/') && entryId.endsWith('/'), entryId);
      assert.ok(!allBookIds.has(entryId), `Duplicate entry ID: ${entryId}`);
      allBookIds.add(entryId);
      assert.ok(isFile(resolve(localUrlPath(dist, entryId), 'index.html')), entryId);
      text(entry, 'title');
      assert.ok(validDate(text(entry, 'updated')));
      const published = text(entry, 'published');
      assert.ok(validDate(published));
      addedDates.push(published);
      assert.ok(text(entry, 'updated') >= published, entryId);
      assert.equal(first(entry, 'category')?.attributes.term, category);
      const summary = first(entry, 'summary');
      assert.ok(summary && summary.attributes.type === 'text' && summary.children.length === 0);
      assert.ok(trimWhitespace(summary.text));
      assert.ok(hasAuthor(entry), entryId);
      assert.ok(/^(?:CC |CC0(?: |$))/.test(text(entry, 'rights')), entryId);
      assert.equal(links(entry, 'license').length, 1);
      assert.equal(links(entry, 'alternate')[0]?.attributes.href, entryId);
      const acquisitions = children(entry, 'link').filter((link) =>
        link.attributes.rel?.startsWith('http://opds-spec.org/acquisition'));
      assert.ok(acquisitions.length, entryId);
      for (const acquisition of acquisitions) {
        acquisitionCount++;
        assert.equal(acquisition.attributes.rel, 'http://opds-spec.org/acquisition');
        assert.ok(acquisition.attributes.href?.startsWith('https://'));
        const indirect = children(acquisition, 'indirectAcquisition', OPDS);
        if (acquisition.attributes.type === 'text/html') {
          webAcquisitionCount++;
          assert.equal(indirect.length, 1);
          assert.deepEqual(indirect[0].attributes, { type: EPUB });
          assert.equal(indirect[0].children.length, 0);
        } else {
          assert.equal(acquisition.attributes.type, EPUB);
          assert.equal(indirect.length, 0);
        }
        if (acquisition.attributes.href.includes('gumroad.com')) assert.equal(acquisition.attributes.type, 'text/html');
        assert.equal(first(acquisition, 'price', OPDS), undefined);
      }
      for (const image of links(entry, 'http://opds-spec.org/image')) {
        imageCount++;
        const imageUrl = new URL(image.attributes.href);
        assert.equal(imageUrl.host, 'epub.tw');
        assert.ok(!imageUrl.username && !imageUrl.password);
        assert.equal(image.attributes.href.match(/^(?:[a-z][a-z\d+.-]*:)?\/\/([^/?#]*)/i)?.[1], 'epub.tw');
        const path = localUrlPath(dist, image.attributes.href);
        assert.ok(isFile(path), path);
        const magic = readFileSync(path).subarray(0, 8);
        const mime = image.attributes.type;
        assert.ok(
          (mime === 'image/png' && magic.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
          (mime === 'image/jpeg' && magic.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) ||
          (mime === 'image/gif' && ['GIF87a', 'GIF89a'].some((signature) => magic.subarray(0, 6).equals(Buffer.from(signature)))), path,
        );
      }
    }
    assert.deepEqual(addedDates, [...addedDates].sort().reverse(), category);
  }
  const htmlBookIds = new Set(readdirSync(resolve(dist, 'books'), { withFileTypes: true })
    .filter((folder) => folder.isDirectory() && isFile(resolve(dist, 'books', folder.name, 'index.html')))
    .map((folder) => `https://epub.tw/books/${folder.name}/`));
  assert.deepEqual(allBookIds, htmlBookIds, 'OPDS entries and generated book pages differ');
  assert.ok(allBookIds.size, 'The catalog unexpectedly contains no books');
  return `PASS: 5 well-formed OPDS XML feeds; ${allBookIds.size} unique book entries; ` +
    `${acquisitionCount} EPUB acquisitions (${webAcquisitionCount} indirect HTML); ` +
    `${imageCount} cover MIME signatures; routes, links, metadata, sorting, and dates validated.` +
    (reference ? ' Reference XML semantic parity also passed.' : '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(validateOpds(process.argv[2], process.argv[3]));
}
