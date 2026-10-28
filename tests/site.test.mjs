import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve('dist');
const read=(file)=>readFileSync(path.join(root,file),'utf8');
const walk=(dir)=>readdirSync(dir,{withFileTypes:true}).flatMap((e)=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
test('legacy routes, per-book pages and domain files exist',()=>{for(const file of ['index.html','404.html','about.html','posts/index.html','posts/2016-12-30-opds-catalog.html','posts/2017-01-17-usa-birth.html','books/young-power/index.html','books/monkeypotion/index.html','books/usa-birth/index.html','CNAME','.nojekyll'])assert.ok(existsSync(path.join(root,file)),file);assert.equal(read('CNAME').trim(),'www.epub.tw');});
test('local page links, images and fragment targets resolve',()=>{for(const page of walk(root).filter((p)=>p.endsWith('.html'))){const html=readFileSync(page,'utf8');assert.doesNotMatch(html,/\{\{\s*site\./);const base=new URL('/'+path.relative(root,page).replace(/index\.html$/,''),'https://www.epub.tw');for(const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)){const raw=match[1].replaceAll('&amp;','&');if(!raw.startsWith('/')&&!raw.startsWith('#'))continue;const url=new URL(raw,base);let target=path.join(root,decodeURIComponent(url.pathname));if(existsSync(target)&&statSync(target).isDirectory())target=path.join(target,'index.html');assert.ok(existsSync(target),`${page} -> ${raw}`);if(url.hash&&target.endsWith('.html'))assert.ok(readFileSync(target,'utf8').includes(`id="${decodeURIComponent(url.hash.slice(1))}"`),`${page} -> ${raw}`);}}});
test('homepage sorts actual content by added date and puts books before announcements',()=>{const home=read('index.html');const ids=[...home.matchAll(/class="book-card"[\s\S]*?href="\/books\/([^/]+)\//g)].map((m)=>m[1]);const expected=readdirSync('src/content/books').filter((f)=>f.endsWith('.md')).map((f)=>({id:f.slice(0,-3),date:readFileSync('src/content/books/'+f,'utf8').match(/^addedAt: "([^"]+)"/m)[1]})).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id,'en')).map((b)=>b.id);assert.deepEqual(ids,expected);assert.ok(home.indexOf('class="books-section"')<home.indexOf('class="news-section"'));for(const title of ['開始提供 OPDS 編目','《美國的誕生》上架','我們在海洋閱讀'])assert.ok(home.includes(title));assert.doesNotMatch(home,/<script\b|<select|type="search"/);});
test('book pages preserve CC and distinguish direct from indirect EPUB acquisition',()=>{const young=read('books/young-power/index.html');for(const text of ['前往 Gumroad 取得 EPUB','依該站的流程取得 EPUB','CC BY-NC-SA 3.0 TW','郝明義','陳季芳','採訪'])assert.ok(young.includes(text));assert.match(read('books/monkeypotion/index.html'),/暫無封面/);assert.match(read('books/usa-birth/index.html'),/下載 EPUB/);for(const id of ['young-power','monkeypotion','usa-birth'])assert.doesNotMatch(read(`books/${id}/index.html`),/下載 PDF|下載 MOBI|lastCheckedAt|<dt>出版日期/);});
test('output hosts no EPUB files and does not transform original covers',()=>{assert.equal(walk(root).filter((p)=>/\.(epub|mobi|azw3?)$/i.test(p)).length,0);for(const file of ['young-power-original.jpg','usa-birth.png'])assert.deepEqual(readFileSync(path.join(root,'images/covers',file)),readFileSync(path.join('public/images/covers',file)));});
test('every HTML page has language, canonical URL, skip link and one main heading',()=>{for(const page of walk(root).filter((p)=>p.endsWith('.html'))){const html=readFileSync(page,'utf8');assert.match(html,/<html lang="zh-Hant-TW"/);assert.match(html,/<title>[^<]+<\/title>/);assert.match(html,/rel="canonical" href="https:\/\/www\.epub\.tw\//);assert.match(html,/class="skip-link" href="#main"/);assert.equal((html.match(/<h1\b/g)??[]).length,1,page);assert.equal((html.match(/<main\b/g)??[]).length,1,page);}});

test('Plurality preserves CC0 and the official traditional-Chinese EPUB source',()=>{
  const html=read('books/plurality/index.html');
  for(const value of ['多元宇宙：協作技術與民主的未來','衛谷倫','唐鳳','多元宇宙社群','CC0 宣告','CC0 1.0','https://creativecommons.org/publicdomain/zero/1.0/','https://github.com/pluralitybook/plurality/releases/latest/download/Plurality-traditional-mandarin.epub','/images/covers/plurality-zh-tw.png'])assert.ok(html.includes(value),value);
  assert.doesNotMatch(html,/<dt>出版日期/);
  assert.deepEqual(readFileSync(path.join(root,'images/covers/plurality-zh-tw.png')),readFileSync('public/images/covers/plurality-zh-tw.png'));
});

test('Pandemic Year preserves all authors, publication date, and indirect Taiwan Kobo acquisition',()=>{
  const html=read('books/pandemic-year/index.html');
  for(const value of ['走過疫年：病毒、口罩、疫苗、假新聞之日常疫情','延金芝','葉子松','綠葉','邱爸','周世宗','陳小步','張雅玲','穹蒼明月','CC BY-NC-ND 3.0 TW','datetime="2021-08-16"','前往 Kobo 取得 EPUB','https://www.kobo.com/tw/zh/ebook/jrxvWKBgHD-6GyYeohRKDw','EPUB 3（DRM-Free）','依該站的流程取得 EPUB'])assert.ok(html.includes(value),value);
  assert.deepEqual(readFileSync(path.join(root,'images/covers/pandemic-year.jpg')),readFileSync('public/images/covers/pandemic-year.jpg'));
});

test('Zhuyin handbook links the official Chinese EPUB and explains fixed-layout compatibility',()=>{
  const html=read('books/zhuyin-handbook/index.html');
  for(const value of ['國語注音符號手冊','教育部','CC BY-ND 3.0 TW','https://language.moe.gov.tw/001/Upload/files/site_content/M0001/juyin/epub/zh.epub','EPUB 3 固定版面','讀音與筆順動畫'])assert.ok(html.includes(value),value);
  assert.doesNotMatch(html,/<dt>出版日期/);
  assert.deepEqual(readFileSync(path.join(root,'images/covers/zhuyin-handbook.png')),readFileSync('public/images/covers/zhuyin-handbook.png'));
});

test('all canonical and Open Graph locations use the www host without changing paths',()=>{
  for(const page of walk(root).filter((p)=>p.endsWith('.html'))){
    const html=readFileSync(page,'utf8');
    const route='/'+path.relative(root,page).replace(/index\.html$/,'');
    assert.ok(html.includes('rel="canonical" href="https://www.epub.tw'+route+'"'),route);
    assert.ok(html.includes('property="og:url" content="https://www.epub.tw'+route+'"'),route);
    for(const match of html.matchAll(/property="og:image" content="([^"]+)"/g))assert.ok(match[1].startsWith('https://www.epub.tw/images/covers/'));
    assert.doesNotMatch(html,/(?:href|src)="https?:\/\/epub\.tw(?:\/|")/);
  }
  assert.ok(read('about.html').includes('https://www.epub.tw/opds.xml'));
  assert.ok(read('posts/2016-12-30-opds-catalog.html').includes('https://www.epub.tw/opds.xml'));
});

test('OPDS announcement images follow the page origin and retain original bytes',()=>{
  const html=read('posts/2016-12-30-opds-catalog.html');
  const images=[...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((match)=>match[1]);
  const expected=['01','02','03'].map((n)=>`/images/aldiko_opds_${n}.png`);
  assert.deepEqual(images,expected);
  for(const src of images){
    for(const origin of ['http://www.epub.tw','https://www.epub.tw'])assert.equal(new URL(src,origin).origin,origin);
    assert.deepEqual(readFileSync(path.join(root,src)),readFileSync(path.join('public',src)));
  }
});

test('homepage presents the final island slogan, explains CC/public-domain sources and uses a smaller responsive heading',()=>{
  const html=read('index.html');
  const hero=html.match(/<section class="hero"[\s\S]*?<\/section>/)?.[0];
  assert.ok(hero);
  assert.match(hero,/<h1 id="hero-title">閱讀是在島嶼之間航行。<\/h1>/);
  const subtitle=hero.match(/<p>([\s\S]*?)<\/p>/)?.[1];
  const description='收錄創用 CC 授權與公有領域的 EPUB 電子書，讓好書被更多人讀見。';
  assert.equal(subtitle?.replace(/<[^>]*>/g,''),description);
  assert.ok(subtitle.includes('href="https://creativecommons.org/cc-licenses/"'));
  assert.ok(subtitle.includes('href="https://creativecommons.org/public-domain/"'));
  assert.ok(html.includes('name="description" content="'+description+'"'));
  assert.ok(html.includes('property="og:description" content="'+description+'"'));
  const css=readFileSync('src/styles/global.css','utf8');
  assert.match(css,/\.hero h1\{[^}]*font-size:clamp\(34px,3\.5vw,50px\)/);
  assert.match(css,/@media \(width<=800px\)\{[\s\S]*?\.hero h1\{font-size:38px\}/);
  assert.match(css,/@media \(width<=600px\)\{[\s\S]*?\.hero h1\{[^}]*font-size:clamp\(25px,7\.8vw,31px\)/);
  assert.doesNotMatch(css,/@media \(width<=370px\)\{[^@]*?\.hero h1/);
  assert.ok(html.includes('<title>寶島書庫 epub.tw｜閱讀是在島嶼之間航行。</title>'));
});


test('announcements omit the withdrawn origin post and share a notice-free template',()=>{
  const withdrawn='2016-12-28-the-origin';
  assert.equal(existsSync('src/content/posts/'+withdrawn+'.md'),false);
  assert.equal(existsSync(path.join(root,'posts',withdrawn+'.html')),false);
  const published=readdirSync('src/content/posts').filter((f)=>f.endsWith('.md')).map((f)=>f.slice(0,-3)).sort().reverse();
  for(const id of ['2016-12-30-opds-catalog','2017-01-17-usa-birth'])assert.ok(published.includes(id));
  assert.deepEqual(readdirSync(path.join(root,'posts')).filter((f)=>f.endsWith('.html')&&f!=='index.html').sort(),published.map((id)=>id+'.html').sort());
  for(const page of ['index.html','posts/index.html']){
    const postLinks=[...read(page).matchAll(/href="\/posts\/([^"/]+)\.html"/g)].map((m)=>m[1]);
    assert.deepEqual(postLinks,page==='index.html'?published.slice(0,3):published);
  }
  for(const page of walk(root).filter((p)=>p.endsWith('.html'))){
    assert.doesNotMatch(readFileSync(page,'utf8'),/2016-12-28-the-origin|本站緣起|archive-note|這篇是書庫的歷史公告|文中外部連結及軟體資訊可能已變更|現行閱讀方式請見/);
  }
  assert.doesNotMatch(readFileSync('src/pages/posts/[slug].astro','utf8'),/archive-note|歷史公告|現行閱讀方式請見/);
  assert.doesNotMatch(readFileSync('src/styles/global.css','utf8'),/archive-note/);
});
