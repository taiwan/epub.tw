/** OPDS 1.2 / Atom serialization. https://specs.opds.io/opds-1.2.html */
export const SITE_URL = 'https://www.epub.tw';
// Atom IDs and extension namespaces identify resources, not their current location.
// Preserve them across host changes (RFC 4287 §4.2.6).
const ID_BASE_URL = 'https://epub.tw';
export const NAVIGATION_TYPE = 'application/atom+xml;profile=opds-catalog;kind=navigation';
export const ACQUISITION_TYPE = 'application/atom+xml;profile=opds-catalog;kind=acquisition';
const EPUB_TYPE = 'application/epub+zip';
const ACQUISITION_REL = 'http://opds-spec.org/acquisition';
// Maintained catalog revision: record removals/category changes even for an empty feed.
// This is not a build timestamp. Update deliberately when the catalog structure changes.
export const CATALOG_UPDATED = '2026-10-28';

/** Structural type accepts Astro content entries, without a runtime Astro import. */
export interface OpdsBook {
  id: string;
  body?: string;
  data: {
    title: string;
    contributors: { name: string; role: string }[];
    summary: string;
    cover?: string;
    category: string;
    addedAt: string;
    updatedAt: string;
    publishedAt?: string;
    sourceUrl: string;
    acquisition: { type: 'direct' | 'web'; url: string; label: string }[];
    license: { name: string; url: string; evidenceUrl?: string };
    language: string;
    readingUrl?: string;
  };
}

export function escapeXml(value: string): string {
  // Reject invalid XML 1.0 characters rather than silently corrupting source metadata.
  if (/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(value)) {
    throw new Error('Metadata contains a character disallowed by XML 1.0.');
  }
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]!);
}

function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).href;
}

function timestamp(date: string): string {
  return `${date}T00:00:00Z`;
}

function latestUpdate(books: readonly OpdsBook[]): string {
  return books.reduce(
    (latest, book) => book.data.updatedAt > latest ? book.data.updatedAt : latest,
    CATALOG_UPDATED,
  );
}

function link(rel: string, href: string, type?: string, title?: string, children?: string): string {
  const attributes = [
    `rel="${escapeXml(rel)}"`,
    `href="${escapeXml(absoluteUrl(href))}"`,
    ...(type ? [`type="${escapeXml(type)}"`] : []),
    ...(title ? [`title="${escapeXml(title)}"`] : []),
  ].join(' ');
  return children ? `<link ${attributes}>${children}</link>` : `<link ${attributes}/>`;
}

function feed(title: string, path: string, kind: 'navigation' | 'acquisition', updated: string, entries: string[]): string {
  const type = kind === 'navigation' ? NAVIGATION_TYPE : ACQUISITION_TYPE;
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/" xmlns:opds="http://opds-spec.org/2010/catalog" xmlns:epubtw="https://epub.tw/ns/catalog" xml:lang="zh-Hant">
  <id>${escapeXml(new URL(path, ID_BASE_URL).href)}</id>
  <title>${escapeXml(title)}</title>
  <updated>${timestamp(updated)}</updated>
  <author><name>寶島書庫</name><uri>${SITE_URL}/</uri></author>
  ${link('self', path, type)}
  ${link('start', '/opds.xml', NAVIGATION_TYPE)}
  ${kind === 'acquisition' ? link('up', '/opds.xml', NAVIGATION_TYPE) : ''}
  ${link('alternate', '/', 'text/html', '寶島書庫')}
${entries.join('\n')}
</feed>
`;
}

function coverMime(cover: string): string | undefined {
  const extension = new URL(cover, SITE_URL).pathname.split('.').pop()?.toLowerCase();
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif' } as Record<string, string>)[extension ?? ''];
}

function entry(book: OpdsBook, categoryLabel: string): string {
  const { data } = book;
  const bookUrl = `/books/${encodeURIComponent(book.id)}/`;
  const creatorRoles = new Set(['作者', '著者', '著', '採訪', '編著', 'author', 'interviewer']);
  const contributors = data.contributors.map(({ name, role }) => {
    const element = creatorRoles.has(role) ? 'author' : 'contributor';
    // Preserve the exact role without adding it to the person's or organization's name.
    return `<${element}><name>${escapeXml(name)}</name><epubtw:role>${escapeXml(role)}</epubtw:role></${element}>`;
  });
  const images: string[] = [];
  if (data.cover) {
    const mime = coverMime(data.cover);
    if (!mime) throw new Error(`Unsupported OPDS cover format for ${book.id}: ${data.cover}`);
    images.push(link('http://opds-spec.org/image', data.cover, mime));
    // Do not mislabel the original as a separate reduced-size thumbnail.
  }
  const acquisitions = data.acquisition.map((acquisition) => link(
    ACQUISITION_REL,
    acquisition.url,
    acquisition.type === 'direct' ? EPUB_TYPE : 'text/html',
    acquisition.label,
    acquisition.type === 'web' ? `<opds:indirectAcquisition type="${EPUB_TYPE}"/>` : undefined,
  ));
  return `  <entry>
    <id>${escapeXml(new URL(bookUrl, ID_BASE_URL).href)}</id>
    <title>${escapeXml(data.title)}</title>
    <published>${timestamp(data.addedAt)}</published>
    <updated>${timestamp(data.updatedAt)}</updated>
    ${contributors.join('\n    ')}
    <dc:language>${escapeXml(data.language)}</dc:language>
    ${data.publishedAt ? `<dc:issued>${escapeXml(data.publishedAt)}</dc:issued>` : ''}
    <category term="${escapeXml(data.category)}" label="${escapeXml(categoryLabel)}"/>
    <summary type="text">${escapeXml(data.summary)}</summary>
    ${book.body?.trim() ? `<content type="text">${escapeXml(book.body.trim())}</content>` : ''}
    <rights>${escapeXml(data.license.name)}</rights>
    ${link('license', data.license.url, 'text/html', data.license.name)}
    ${data.license.evidenceUrl ? link('related', data.license.evidenceUrl, 'text/html', '授權依據') : ''}
    ${link('alternate', bookUrl, 'text/html', '書籍介紹')}
    ${link('related', data.sourceUrl, 'text/html', '書籍來源')}
    ${data.readingUrl ? link('related', data.readingUrl, 'text/html', '線上閱讀') : ''}
    ${images.join('\n    ')}
    ${acquisitions.join('\n    ')}
  </entry>`;
}

export function renderNavigationFeed(books: readonly OpdsBook[], categories: Readonly<Record<string, string>>): string {
  const entries = Object.entries(categories).map(([category, label]) => {
    const categoryBooks = books.filter((book) => book.data.category === category);
    const path = `/categories/${category}.xml`;
    return `  <entry>
    <id>${escapeXml(new URL(path, ID_BASE_URL).href)}</id>
    <title>${escapeXml(label)}</title>
    <updated>${timestamp(latestUpdate(categoryBooks))}</updated>
    <content type="text">${escapeXml(label)}類書籍，共 ${categoryBooks.length} 本。</content>
    ${link('subsection', path, ACQUISITION_TYPE, label)}
  </entry>`;
  });
  return feed('寶島書庫', '/opds.xml', 'navigation', latestUpdate(books), entries);
}

export function renderAcquisitionFeed(category: string, categoryLabel: string, books: readonly OpdsBook[]): string {
  const categoryBooks = books
    .filter((book) => book.data.category === category)
    .toSorted((a, b) => b.data.addedAt.localeCompare(a.data.addedAt) || a.id.localeCompare(b.id));
  return feed(
    `${categoryLabel} — 寶島書庫`,
    `/categories/${category}.xml`,
    'acquisition',
    latestUpdate(categoryBooks),
    categoryBooks.map((book) => entry(book, categoryLabel)),
  );
}
