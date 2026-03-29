'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT           = 3000;
const SUBMISSIONS_DIR = path.join(__dirname, 'submissions');
const TERMS_VERSION  = '1.0.0';
const TERMS_DATE     = '2026-02-25';

// submissions/ ディレクトリがなければ作成
if (!fs.existsSync(SUBMISSIONS_DIR)) {
  fs.mkdirSync(SUBMISSIONS_DIR, { recursive: true });
}

// -------------------------------------------------------
// 規約テキスト（HTMLの表示内容と一致させること）
// バージョンを変えるときはここと index.html と TERMS_VERSION を更新する
// -------------------------------------------------------
function termsText() {
  return `### 第1条（目的）
本規約は、イベントスペース（以下「本スペース」）を利用するにあたっての条件を定めるものです。

### 第2条（利用申込）
本スペースの利用を希望する方は、本規約に同意のうえ、所定の申込フォームにて申込を行うものとします。

### 第3条（禁止事項）
利用者は、以下の行為を行ってはなりません。

- 法令または公序良俗に反する行為
- 他の利用者または第三者に迷惑・損害を与える行為
- 本スペースの設備・備品を破損・汚損する行為
- 許可なく飲食を持ち込む行為
- 火気の使用（主催者が許可した場合を除く）
- 騒音・振動など近隣への迷惑行為
- 本スペースの転貸・又貸し

### 第4条（損害賠償）
利用者の故意または過失により本スペースまたは設備に損害が生じた場合、利用者はその損害を賠償するものとします。

### 第5条（個人情報の取り扱い）
申込時に取得した個人情報は、本スペースの運営管理のみに使用し、第三者への提供は行いません。

### 第6条（免責事項）
本スペースの運営者は、利用者が本スペースを利用することにより生じた損害について、運営者の故意または重大な過失による場合を除き、責任を負いません。

### 第7条（規約の変更）
本規約は予告なく変更される場合があります。変更後の規約は本スペースの申込フォームに掲示した時点から効力を生じます。`;
}

// -------------------------------------------------------
// ユーティリティ
// -------------------------------------------------------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeFilename(nickname) {
  // ファイル名に使える文字だけ残す（日本語OK、制御文字等はアンダースコアへ）
  return nickname.replace(/[^\w\u3040-\u30FF\u4E00-\u9FFF]/g, '_').slice(0, 50);
}

function nowTimestamp() {
  const d = new Date();
  // ローカル時刻ではなく ISO 8601 UTC で保存
  return d.toISOString();
}

function filenameTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// -------------------------------------------------------
// 日程のバリデーション（YYYY-MM-DD 形式チェック）
// -------------------------------------------------------
function isValidDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
}

function calcDays(start, end) {
  return Math.round((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)) + 1;
}

// -------------------------------------------------------
// Markdown 記録ファイルを生成
// -------------------------------------------------------
function buildMarkdown(nickname, startDate, endDate, ip, timestamp, clientTermsVersion) {
  const days = calcDays(startDate, endDate);
  return `# イベントスペース利用申込記録

## 申込情報

| 項目 | 内容 |
|------|------|
| 申込日時 (UTC) | ${timestamp} |
| ニックネーム | ${nickname} |
| 利用開始日 | ${startDate} |
| 利用終了日 | ${endDate} |
| 利用日数 | ${days}日間 |
| IPアドレス | ${ip} |
| 規約バージョン（フォーム表示） | ${clientTermsVersion} |
| 規約バージョン（サーバー記録） | ${TERMS_VERSION} |
| 規約同意 | ✓ 同意済み |

---

## 同意した規約 (バージョン ${TERMS_VERSION} / ${TERMS_DATE})

${termsText()}
`;
}

// -------------------------------------------------------
// リクエストハンドラ
// -------------------------------------------------------
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // GET / → フォームページを返す
  if (req.method === 'GET' && parsed.pathname === '/') {
    const htmlPath = path.join(__dirname, 'index.html');
    fs.readFile(htmlPath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // POST /submit → 申込を受け付けて Markdown に保存
  if (req.method === 'POST' && parsed.pathname === '/submit') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      const params         = new URLSearchParams(body);
      const nickname       = (params.get('nickname') || '').trim();
      const startDate      = (params.get('start_date') || '').trim();
      const endDate        = (params.get('end_date') || '').trim();
      const agreed         = params.get('agreed') === 'on';
      const clientTermsVer = params.get('terms_version') || '(不明)';

      // バリデーション
      if (!nickname || !agreed) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<p>必須項目が入力されていないか、規約に同意されていません。<a href="/">戻る</a></p>');
        return;
      }
      if (!isValidDate(startDate) || !isValidDate(endDate)) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<p>日付の形式が正しくありません。<a href="/">戻る</a></p>');
        return;
      }
      if (endDate < startDate) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<p>終了日は開始日以降の日付を指定してください。<a href="/">戻る</a></p>');
        return;
      }

      const ip        = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
      const timestamp = nowTimestamp();
      const filename  = `${filenameTimestamp()}_${safeFilename(nickname)}.md`;
      const filepath  = path.join(SUBMISSIONS_DIR, filename);
      const markdown  = buildMarkdown(nickname, startDate, endDate, ip, timestamp, clientTermsVer);

      fs.writeFile(filepath, markdown, 'utf8', (err) => {
        if (err) {
          console.error('[ERROR] ファイル書き込み失敗:', err);
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<p>保存中にエラーが発生しました。<a href="/">戻る</a></p>');
          return;
        }
        console.log(`[OK] 申込を保存: ${filename}`);
        // 完了ページへリダイレクト
        res.writeHead(302, { 'Location': '/thanks?name=' + encodeURIComponent(nickname) });
        res.end();
      });
    });
    return;
  }

  // GET /thanks → 完了ページ
  if (req.method === 'GET' && parsed.pathname === '/thanks') {
    const name = parsed.query.name || '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>申込完了 - イベントスペース</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif;
           background: #f5f5f5; color: #333; }
    .box { max-width: 480px; margin: 80px auto; background: white;
           border-radius: 10px; padding: 40px; text-align: center;
           box-shadow: 0 2px 8px rgba(0,0,0,0.09); }
    .check { font-size: 3rem; color: #2c7a2c; }
    h1 { font-size: 1.4rem; margin: 12px 0 8px; }
    p  { color: #555; font-size: 0.95rem; margin: 6px 0; }
    a  { display: inline-block; margin-top: 24px; color: #2c7a2c;
         text-decoration: none; font-size: 0.9rem; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="box">
    <div class="check">&#10003;</div>
    <h1>申込が完了しました</h1>
    <p>${escapeHtml(name)} さん、ありがとうございます。</p>
    <p>規約への同意と申込内容を記録しました。</p>
    <a href="/">最初のページに戻る</a>
  </div>
</body>
</html>`);
    return;
  }

  // その他 → 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`起動しました → http://localhost:${PORT}/`);
  console.log(`申込記録の保存先: ${SUBMISSIONS_DIR}`);
});
