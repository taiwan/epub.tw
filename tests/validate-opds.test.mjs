import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseXml, validateOpds } from './validate-opds.mjs';

const build = fileURLToPath(new URL('../dist/', import.meta.url));
const script = fileURLToPath(new URL('./validate-opds.mjs', import.meta.url));
const ATOM = 'http://www.w3.org/2005/Atom';
const ACQUISITION = 'http://opds-spec.org/acquisition';
const FEEDS = ['opds.xml', ...['biography', 'history', 'society', 'technology'].map((category) => `categories/${category}.xml`)];
const BIO = 'categories/biography.xml';
const HISTORY = 'categories/history.xml';
const SOCIETY = 'categories/society.xml';

// All mutations operate on their own copied build, never on dist or the reference.
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'epub-opds-test-'));
  const dist = join(directory, 'dist');
  cpSync(build, dist, { recursive: true });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return dist;
}

function edit(dist, path, transform) {
  const file = join(dist, path);
  const before = readFileSync(file, 'utf8');
  const after = transform(before);
  assert.notEqual(after, before, `Test mutation must change ${path}`);
  writeFileSync(file, after);
}

function entry(xml, transform) {
  return xml.replace(/<entry>[\s\S]*?<\/entry>/, transform);
}

function header(xml, transform) {
  const split = xml.indexOf('<entry>');
  return split < 0 ? transform(xml) : transform(xml.slice(0, split)) + xml.slice(split);
}

function element(xml, name, replacement = '') {
  return xml.replace(new RegExp(`<${name}(?: [^>]*)?>[\\s\\S]*?<\\/${name}>`), replacement);
}

function link(xml, rel, transform) {
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return xml.replace(new RegExp(`<link rel="${escaped}"[^>]*(?:\\/>|>[\\s\\S]*?<\\/link>)`), transform);
}

function mutation(name, path, transform, expected) {
  test(`rejects ${name}`, (t) => {
    const dist = fixture(t);
    edit(dist, path, transform);
    assert.throws(() => validateOpds(dist), expected);
  });
}

const changeBook = (name, path, transform, expected) =>
  mutation(name, path, (xml) => entry(xml, transform), expected);
const changeHeader = (name, path, transform, expected) =>
  mutation(name, path, (xml) => header(xml, transform), expected);

// Strict parser, namespaces, entities, CDATA, and mixed-content text handling.
test('parser expands namespace names and ignores equivalent prefix declarations', () => {
  const defaultNamespace = `<feed xmlns="${ATOM}" xmlns:m="urn:metadata"><title m:flag="yes">Book</title></feed>`;
  const aliases = `<a:feed xmlns:a="${ATOM}" xmlns:other="urn:metadata"><a:title other:flag="yes">Book</a:title></a:feed>`;
  assert.deepEqual(parseXml(defaultNamespace), parseXml(aliases));
  assert.equal(parseXml(aliases).children[0].attributes['{urn:metadata}flag'], 'yes');
});

test('parser combines entity, CDATA, Unicode, and character-reference text', () => {
  const parsed = parseXml(Buffer.from('<title>A &amp; B<![CDATA[ <sea>]]>&#x3002;&#33;海</title>'));
  assert.equal(parsed.text, 'A & B <sea>。!海');
});

test('parser retains leading text and child tails and ignores comments/instructions', () => {
  const parsed = parseXml('<entry>before<!-- note --><?note value?><title>Book</title>between<summary>Summary</summary>after</entry>');
  assert.equal(parsed.text, 'before');
  assert.equal(parsed.children[0].tail, 'between');
  assert.equal(parsed.children[1].tail, 'after');
  assert.equal(parsed.children.length, 2);
});

for (const [name, xml] of [
  ['empty document', ''],
  ['unclosed element', '<feed>'],
  ['mismatched closing element', '<feed><title>Book</feed>'],
  ['multiple roots', '<feed/><feed/>'],
  ['trailing non-XML content', '<feed/>oops'],
  ['unbound namespace prefix', '<missing:feed/>'],
  ['duplicate ordinary attribute', '<feed id="a" id="b"/>'],
  ['duplicate expanded attribute', '<feed xmlns:a="urn:x" xmlns:b="urn:x" a:id="a" b:id="b"/>'],
  ['undeclared entity', '<feed>&unknown;</feed>'],
  ['invalid XML control character', '<feed>\u0000</feed>'],
  ['external DTD', '<!DOCTYPE feed SYSTEM "https://example.invalid/never-fetch"><feed/>'],
  ['internal DTD/entity', '<!DOCTYPE feed [<!ENTITY value "data">]><feed>&value;</feed>'],
]) {
  test(`strict parser rejects ${name}`, () => assert.throws(() => parseXml(xml)));
}

test('strict parser rejects invalid UTF-8 bytes rather than replacing them', () => {
  const invalid = Buffer.concat([Buffer.from('<feed>'), Buffer.from([0xc3, 0x28]), Buffer.from('</feed>')]);
  assert.throws(() => parseXml(invalid));
});

// Success and semantic-reference comparison.
test('validates the current build with complete catalog counters', (t) => {
  const dist = fixture(t);
  const entries = FEEDS.slice(1).flatMap((path) => parseXml(readFileSync(join(dist, path)))
    .children.filter((node) => node.tag === `{${ATOM}}entry`));
  const entryLinks = entries.flatMap((node) => node.children.filter((child) => child.tag === `{${ATOM}}link`));
  const acquisitions = entryLinks.filter((node) => node.attributes.rel === ACQUISITION);
  const indirectCount = acquisitions.filter((node) => node.attributes.type === 'text/html').length;
  const coverCount = entryLinks.filter((node) => node.attributes.rel === 'http://opds-spec.org/image').length;
  const pageCount = readdirSync(join(dist, 'books'), { withFileTypes: true }).filter((node) => node.isDirectory() && statSync(join(dist, 'books', node.name, 'index.html'), { throwIfNoEntry: false })?.isFile()).length;
  assert.ok(validateOpds(dist).startsWith(
    `PASS: ${FEEDS.length} well-formed OPDS XML feeds; ${pageCount} unique book entries; ` +
    `${acquisitions.length} EPUB acquisitions (${indirectCount} indirect HTML); ${coverCount} cover MIME signatures;`,
  ));
});

test('supports exact optional reference parity', (t) => {
  const dist = fixture(t);
  assert.match(validateOpds(dist, dist), /Reference XML semantic parity also passed\.$/);
});

test('reference parity ignores indentation and attribute ordering', (t) => {
  const dist = fixture(t);
  for (const path of FEEDS) {
    edit(dist, path, (xml) => xml.replace(/>\s+</g, '>\n\t<').replace(/rel="self" href="([^"]+)"/, 'href="$1" rel="self"'));
  }
  assert.match(validateOpds(dist, build), /Reference XML semantic parity also passed/);
});

test('reference parity ignores namespace prefix choices, including all Atom tags', (t) => {
  const dist = fixture(t);
  for (const path of FEEDS) {
    edit(dist, path, (xml) => xml
      .replace(`xmlns="${ATOM}"`, `xmlns:a="${ATOM}"`)
      .replace(/<(\/?)([A-Za-z][\w-]*)(?=[\s/>])/g, '<$1a:$2')
      .replace('xmlns:opds=', 'xmlns:o=')
      .replaceAll('<opds:', '<o:').replaceAll('</opds:', '</o:'));
  }
  assert.match(validateOpds(dist, build), /Reference XML semantic parity also passed/);
});

test('reference parity rejects changed description even when catalog checks pass', (t) => {
  const dist = fixture(t);
  edit(dist, BIO, (xml) => xml.replace('<summary type="text">', '<summary type="text">Changed. '));
  assert.match(validateOpds(dist), /^PASS:/);
  assert.throws(() => validateOpds(dist, build), /Preview parity failed/);
});

test('reference parity rejects semantic child-order changes', (t) => {
  const dist = fixture(t);
  edit(dist, HISTORY, (xml) => xml.replace(/(<id>[^<]+<\/id>)(\s*)(<title>[^<]+<\/title>)/, '$3$2$1'));
  assert.match(validateOpds(dist), /^PASS:/);
  assert.throws(() => validateOpds(dist, build), /Preview parity failed/);
});

test('reference parity preserves significant mixed-content tails', (t) => {
  const dist = fixture(t);
  edit(dist, HISTORY, (xml) => xml.replace('</title>', '</title>unexpected text'));
  assert.throws(() => validateOpds(dist, build), /Preview parity failed/);
});

// Feed-level and navigation assertions.
mutation('a feed in the wrong namespace', 'opds.xml', (xml) => xml.replace(ATOM, 'urn:not-atom'));
mutation('XML control character in a feed loaded from disk', 'opds.xml', (xml) => xml.replace('寶島書庫', '\u0000'));
test('feed loading rejects non-UTF-8 byte sequences', (t) => {
  const dist = fixture(t);
  const file = join(dist, 'opds.xml');
  const data = readFileSync(file);
  writeFileSync(file, Buffer.concat([data.subarray(0, data.indexOf(Buffer.from('寶島書庫'))), Buffer.from([0xff]), data.subarray(data.indexOf(Buffer.from('寶島書庫')) + 3)]));
  assert.throws(() => validateOpds(dist));
});
changeHeader('wrong feed identifier', 'opds.xml', (xml) => element(xml, 'id', '<id>https://example.org/opds.xml</id>'));
changeHeader('missing feed title', 'opds.xml', (xml) => element(xml, 'title'));
changeHeader('missing feed author', 'opds.xml', (xml) => element(xml, 'author'));
changeHeader('missing self link', 'opds.xml', (xml) => link(xml, 'self', () => ''));
changeHeader('duplicate self links', 'opds.xml', (xml) => link(xml, 'self', (tag) => tag + tag));
changeHeader('wrong self link media type', 'opds.xml', (xml) => link(xml, 'self', (tag) => tag.replace('kind=navigation', 'kind=acquisition')));
changeHeader('missing start link', BIO, (xml) => link(xml, 'start', () => ''));
changeHeader('incorrect start href', BIO, (xml) => link(xml, 'start', (tag) => tag.replace('https://epub.tw/opds.xml', 'https://example.org/opds.xml')));
changeHeader('extra start attributes', BIO, (xml) => link(xml, 'start', (tag) => tag.replace('/>', ' title="extra"/>')));
changeHeader('incorrect up link', BIO, (xml) => link(xml, 'up', (tag) => tag.replace('https://epub.tw/opds.xml', 'https://epub.tw/')));
mutation('missing navigation category', 'opds.xml', (xml) => entry(xml, () => ''));
mutation('extra navigation category', 'opds.xml', (xml) => entry(xml, (tag) => tag + tag));
changeBook('missing navigation identifier', 'opds.xml', (xml) => element(xml, 'id'));
changeBook('missing navigation title', 'opds.xml', (xml) => element(xml, 'title'));
changeBook('invalid navigation timestamp', 'opds.xml', (xml) => element(xml, 'updated', '<updated>yesterday</updated>'));
changeBook('missing subsection link', 'opds.xml', (xml) => link(xml, 'subsection', () => ''));
changeBook('duplicate subsection links', 'opds.xml', (xml) => link(xml, 'subsection', (tag) => tag + tag));
changeBook('incorrect subsection media type', 'opds.xml', (xml) => link(xml, 'subsection', (tag) => tag.replace('kind=acquisition', 'kind=navigation')));
changeBook('incorrect category route', 'opds.xml', (xml) => link(xml, 'subsection', (tag) => tag.replace('/categories/biography.xml', '/categories/fiction.xml')));

// Dates: retain the former full-match rule and reject invalid calendar dates.
for (const [name, date] of [
  ['non-ISO format', '2026/10/28'],
  ['nonmidnight timestamp', '2026-10-28T01:00:00Z'],
  ['trailing newline', '2026-10-28T00:00:00Z\n'],
  ['invalid calendar date', '2026-02-30T00:00:00Z'],
]) {
  changeHeader(`feed date with ${name}`, BIO, (xml) => element(xml, 'updated', `<updated>${date}</updated>`));
}
changeBook('invalid book added date', BIO, (xml) => element(xml, 'published', '<published>today</published>'));
changeBook('invalid book updated date', BIO, (xml) => element(xml, 'updated', '<updated>2026-13-01T00:00:00Z</updated>'));
changeBook('updated date before added date', BIO, (xml) => element(xml, 'updated', '<updated>2010-01-01T00:00:00Z</updated>'));

// Entry metadata, uniqueness, and bidirectional generated-page parity.
changeBook('external book identifier', BIO, (xml) => element(xml, 'id', '<id>https://example.org/books/monkeypotion/</id>'));
changeBook('book identifier without trailing slash', BIO, (xml) => xml.replace('<id>https://epub.tw/books/monkeypotion/</id>', '<id>https://epub.tw/books/monkeypotion</id>'));
mutation('duplicate book identifiers', BIO, (xml) => entry(xml, (tag) => tag + tag), /Duplicate entry ID/);
changeBook('missing book title', BIO, (xml) => element(xml, 'title'));
changeBook('incorrect category metadata', BIO, (xml) => xml.replace('term="biography"', 'term="history"'));
changeBook('missing summary', BIO, (xml) => element(xml, 'summary'));
changeBook('HTML summary type', BIO, (xml) => xml.replace('<summary type="text">', '<summary type="html">'));
changeBook('child element inside summary', BIO, (xml) => element(xml, 'summary', '<summary type="text">Description <b>child</b></summary>'));
changeBook('blank summary', BIO, (xml) => element(xml, 'summary', '<summary type="text"> \n </summary>'));
changeBook('missing book author', BIO, (xml) => element(xml, 'author'));
changeBook('non-CC rights', BIO, (xml) => element(xml, 'rights', '<rights>All rights reserved</rights>'));
changeBook('missing license link', BIO, (xml) => link(xml, 'license', () => ''));
changeBook('duplicate license links', BIO, (xml) => link(xml, 'license', (tag) => tag + tag));
changeBook('incorrect alternate book-page link', BIO, (xml) => link(xml, 'alternate', (tag) => tag.replace('/books/monkeypotion/', '/books/other/')));

test('rejects missing generated book page', (t) => {
  const dist = fixture(t);
  rmSync(join(dist, 'books/monkeypotion/index.html'));
  assert.throws(() => validateOpds(dist));
});

test('rejects a directory where a book HTML file is required', (t) => {
  const dist = fixture(t);
  const path = join(dist, 'books/monkeypotion/index.html');
  rmSync(path);
  mkdirSync(path);
  assert.throws(() => validateOpds(dist));
});

test('rejects orphan book pages missing from OPDS', (t) => {
  const dist = fixture(t);
  cpSync(join(dist, 'books/monkeypotion'), join(dist, 'books/orphan'), { recursive: true });
  assert.throws(() => validateOpds(dist), /OPDS entries and generated book pages differ/);
});

test('rejects completely empty book catalog even when page and feed sets agree', (t) => {
  const dist = fixture(t);
  for (const path of FEEDS.slice(1)) {
    if (readFileSync(join(dist, path), 'utf8').includes('<entry>')) {
      edit(dist, path, (xml) => xml.replaceAll(/<entry>[\s\S]*?<\/entry>/g, ''));
    }
  }
  rmSync(join(dist, 'books'), { recursive: true });
  mkdirSync(join(dist, 'books'));
  assert.throws(() => validateOpds(dist), /catalog unexpectedly contains no books/);
});

test('rejects books not sorted by addition date within their category', (t) => {
  const dist = fixture(t);
  cpSync(join(dist, 'books/monkeypotion'), join(dist, 'books/newer'), { recursive: true });
  edit(dist, BIO, (xml) => entry(xml, (tag) => tag + tag
    .replaceAll('/books/monkeypotion/', '/books/newer/')
    .replace('<published>2018-02-03T00:00:00Z</published>', '<published>2026-10-28T00:00:00Z</published>')));
  assert.throws(() => validateOpds(dist), /biography/);
});

// Acquisition semantics, exact indirect structure, and EPUB-only MIME handling.
changeBook('missing acquisition link', BIO, (xml) => link(xml, ACQUISITION, () => ''));
changeBook('false open-access acquisition relation', BIO, (xml) => link(xml, ACQUISITION, (tag) => tag.replace(ACQUISITION, ACQUISITION + '/open-access')));
changeBook('non-HTTPS acquisition URL', BIO, (xml) => link(xml, ACQUISITION, (tag) => tag.replace('href="https://', 'href="http://')));
changeBook('non-EPUB direct MIME type', BIO, (xml) => link(xml, ACQUISITION, (tag) => tag.replace('application/epub+zip', 'application/pdf')));
changeBook('indirection on a direct EPUB link', BIO, (xml) => link(xml, ACQUISITION, (tag) => tag.replace('/>', '><opds:indirectAcquisition type="application/epub+zip"/></link>')));
changeBook('missing HTML indirect acquisition', SOCIETY, (xml) => xml.replace('<opds:indirectAcquisition type="application/epub+zip"/>', ''));
changeBook('duplicate HTML indirect acquisitions', SOCIETY, (xml) => xml.replace('<opds:indirectAcquisition type="application/epub+zip"/>', '<opds:indirectAcquisition type="application/epub+zip"/><opds:indirectAcquisition type="application/epub+zip"/>'));
changeBook('non-EPUB indirect MIME', SOCIETY, (xml) => xml.replace('<opds:indirectAcquisition type="application/epub+zip"/>', '<opds:indirectAcquisition type="application/pdf"/>'));
changeBook('extra indirect acquisition attributes', SOCIETY, (xml) => xml.replace('<opds:indirectAcquisition type="application/epub+zip"/>', '<opds:indirectAcquisition type="application/epub+zip" title="extra"/>'));
changeBook('nested indirect acquisition child', SOCIETY, (xml) => xml.replace('<opds:indirectAcquisition type="application/epub+zip"/>', '<opds:indirectAcquisition type="application/epub+zip"><opds:indirectAcquisition type="application/epub+zip"/></opds:indirectAcquisition>'));
changeBook('wrong indirect acquisition namespace', SOCIETY, (xml) => xml.replace('<opds:indirectAcquisition type="application/epub+zip"/>', '<indirectAcquisition type="application/epub+zip"/>'));
mutation('Gumroad pretending to be a direct EPUB file', SOCIETY, (xml) => xml.replace(/<entry>[\s\S]*?<\/entry>/g, (entryXml) => entryXml.includes('gumroad.com')
  ? link(entryXml, ACQUISITION, (tag) => tag.replace('type="text/html"', 'type="application/epub+zip"').replace('<opds:indirectAcquisition type="application/epub+zip"/>', ''))
  : entryXml));
changeBook('price on a generic acquisition', SOCIETY, (xml) => link(xml, ACQUISITION, (tag) => tag.replace('</link>', '<opds:price currencycode="USD">0</opds:price></link>')));

// Cover host, filesystem boundary, and actual image bytes rather than filenames.
for (const [name, host] of [
  ['external host', 'example.org'],
  ['credentials', 'reader@epub.tw'],
  ['explicit default HTTPS port', 'epub.tw:443'],
  ['nondefault port', 'epub.tw:8443'],
]) {
  changeBook(`cover URL with ${name}`, HISTORY, (xml) => link(xml, 'http://opds-spec.org/image', (tag) => tag.replace('https://epub.tw/', `https://${host}/`)));
}
changeBook('cover extension with incorrect declared MIME', HISTORY, (xml) => link(xml, 'http://opds-spec.org/image', (tag) => tag.replace('image/png', 'image/jpeg')));
changeBook('cover URL escaping the build directory after percent-decoding', HISTORY, (xml) => link(xml, 'http://opds-spec.org/image', (tag) => tag.replace('/images/covers/usa-birth.png', '/images/%2e%2e%2f%2e%2e%2fescape.png')), /Path outside build/);

test('rejects missing cover file', (t) => {
  const dist = fixture(t);
  rmSync(join(dist, 'images/covers/usa-birth.png'));
  assert.throws(() => validateOpds(dist));
});

test('rejects a directory where a cover file is required', (t) => {
  const dist = fixture(t);
  const path = join(dist, 'images/covers/usa-birth.png');
  rmSync(path);
  mkdirSync(path);
  assert.throws(() => validateOpds(dist));
});

test('rejects bogus image bytes even when filename and MIME both say PNG', (t) => {
  const dist = fixture(t);
  writeFileSync(join(dist, 'images/covers/usa-birth.png'), 'not an image');
  assert.throws(() => validateOpds(dist));
});

for (const signature of ['GIF87a', 'GIF89a']) {
  test(`accepts genuine ${signature} image signature with GIF MIME`, (t) => {
    const dist = fixture(t);
    edit(dist, HISTORY, (xml) => link(xml, 'http://opds-spec.org/image', (tag) => tag.replace('usa-birth.png', 'test.gif').replace('image/png', 'image/gif')));
    writeFileSync(join(dist, 'images/covers/test.gif'), Buffer.from(signature + '\x01\x00'));
    assert.match(validateOpds(dist), /^PASS:/);
  });
}

// CLI compatibility: default dist, explicit dist + reference, nonzero failure status.
test('CLI validates default dist in its working directory', (t) => {
  const dist = fixture(t);
  const result = spawnSync(process.execPath, [script], { cwd: dirname(dist), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^PASS:/);
});

test('CLI accepts explicit dist and optional semantic reference', (t) => {
  const dist = fixture(t);
  const result = spawnSync(process.execPath, [script, dist, dist], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Reference XML semantic parity also passed/);
});

test('CLI exits nonzero and never reports success for an invalid catalog', (t) => {
  const dist = fixture(t);
  edit(dist, BIO, (xml) => entry(xml, (tag) => element(tag, 'title')));
  const result = spawnSync(process.execPath, [script, dist], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /PASS:/);
  assert.match(result.stderr, /Missing title/);
});


test('rejects high-bit bytes that ASCII decoding would mistake for a GIF signature', (t) => {
  const dist = fixture(t);
  edit(dist, HISTORY, (xml) => link(xml, 'http://opds-spec.org/image', (tag) => tag.replace('usa-birth.png', 'false.gif').replace('image/png', 'image/gif')));
  writeFileSync(join(dist, 'images/covers/false.gif'), Buffer.from([0xc7, 0xc9, 0xc6, 0xb8, 0xb7, 0xe1, 1, 0]));
  assert.throws(() => validateOpds(dist));
});

changeBook('summary containing only Unicode NEXT LINE whitespace', BIO, (xml) => element(xml, 'summary', '<summary type="text">\u0085</summary>'));

test('reference parity does not trim meaningful zero-width no-break characters', (t) => {
  const dist = fixture(t);
  edit(dist, BIO, (xml) => xml.replace('<summary type="text">', '<summary type="text">\ufeff'));
  assert.throws(() => validateOpds(dist, build), /Preview parity failed/);
});
