# 寶島書庫 · epub.tw

使用 Astro + TypeScript 的靜態 EPUB 書目網站。只收錄提供 EPUB、且明確採用創用 CC 授權的來源；不保存書檔。

## 開發與驗證

使用 Node.js 24。

```sh
npm ci
npm run dev
npm run verify
npm run preview
```

## 內容

- 一本書一個 `src/content/books/<id>.md`，檔名為穩定 ID；頁面 `/books/<id>/`。
- 每項 `contributors` 具有 `name` 與 `role`，個人及組織皆可。
- `addedAt` 為首次加入日期，`updatedAt` 為實質書目更新日期；都使用固定 `YYYY-MM-DD` 字串，不用建置時間。出版日未知就省略 `publishedAt`。
- `sourceUrl` 指向原始來源。`acquisition` 的 `type: direct` 只用於真正 EPUB 端點；`type: web` 用於提供 EPUB 的網頁，每項另含 `url` 與 `label`。
- `license` 包含名稱與官方條款 `url`，可附 `evidenceUrl`。沿用既有慣例接受 CC0，不能把 CC0 描述成帶有 BY/NC 條件的授權。
- `cover` 可省略，或填寫本機 `/images/covers/` 路徑／HTTPS PNG/JPEG 原版封面。不裁切、不重繪；缺少封面以文字佔位。
- `category` 保留 biography/history/society/technology，`language` 必填；`summary` 為簡介，可另寫 Markdown 正文與 `readingUrl`。
- 公告放在 `src/content/posts/YYYY-MM-DD-slug.md`，保留 `/posts/YYYY-MM-DD-slug.html` 網址。

書架按加入日期新到舊排序，同日以 ID 排序。第一版無搜尋、分類篩選、後台或登入。透過 GitHub Issue／PR 新增及更正，收到問題時核對來源、授權與失效連結，不做排程掃描。請勿提交 EPUB、憑證或個人資料。

## OPDS 與部署

`/opds.xml` 是 OPDS 1.2 分類導覽；四個 `/categories/*.xml` 為取得目錄，空分類亦保留。Gumroad 等中介網頁使用 `text/html` 配合 EPUB indirect acquisition，不冒充直接下載或無條件 open-access。書目 ID 使用本站固定頁面網址。

GitHub Actions 執行 schema、TypeScript、build 與測試。正式分支為 `main`，GitHub Pages 使用 Actions；保留自訂網域 `epub.tw` 與 `public/CNAME`，不需要變更 DNS。
