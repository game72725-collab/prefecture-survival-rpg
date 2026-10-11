// 共通部品：静的サーバ（main.js にテスト用フックを付けて配信）、決定論の初期化、ページを開く関数
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const ROOT = path.resolve(arg('root', '/home/claude/w/v4'));
const MIME = { '.html':'text/html', '.js':'text/javascript', '.png':'image/png', '.webp':'image/webp', '.txt':'text/plain', '.csv':'text/csv' };
// テスト用：main.js の配信時だけ、initGame() の前後に「乱数の再シード」「状態の記録」「（任意）固定配置の差し込み」「目印のオフ」を行うフックを付ける。製品のファイルは変更しない
const HOOK = `
;(function(){
  const __o = initGame;
  initGame = function(){ if(window.__reseedOnInit) window.__reseed(window.__reseedOnInit); __o(); if(window.__onInit) window.__onInit(); if(window.__force) window.__force(); };
  if(window.__markersOff && typeof CONFIG !== 'undefined') CONFIG.SHOW_ITEM_MARKERS = false;
})();
`;
const serve = () => new Promise(res => { const s = http.createServer((req, rsp) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if(!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()){ rsp.writeHead(404); rsp.end(); return; }
  if(path.basename(p) === 'main.js'){ rsp.writeHead(200, { 'Content-Type': 'text/javascript' }); rsp.end(fs.readFileSync(p, 'utf8') + HOOK); return; }
  rsp.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(rsp); }).listen(0, () => res(s)); });
const INIT = (seed0) => `
(() => {
  let seed = ${seed0 || 123456789};
  const mk = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  Math.random = mk; window.__reseed = n => { seed = n; };
  window.__realNow = performance.now.bind(performance);
  let vt = 1000; performance.now = () => vt; window.__setVT = v => { vt = v; }; window.__getVT = () => vt;
  window.__raf = []; window.requestAnimationFrame = f => { window.__raf.push(f); return window.__raf.length; };
  window.__pump = (n, ms) => { for(let i=0;i<n;i++){ const q = window.__raf; window.__raf = []; vt += (ms || 1000/60); q.forEach(f => f(vt)); } };
  window.__initSnaps = [];
  // 目印の描画回数の計測（目印の色の塗り fill() の回数。県庁サーチの星（同じマゼンタ）は Path2D 引数を取らないので、区別できる）。window.__cnt が無ければ何もしない
  const P = CanvasRenderingContext2D.prototype, oFill = P.fill;
  P.fill = function(a){ const c = window.__cnt; if(c && a instanceof Path2D){ const f = this.fillStyle; if(f === '#ffc400') c.chest++; else if(f === '#ff2d95') c.board++; } return oFill.apply(this, arguments); };
})();
`;
// 起動直後の状態の記録（initGame の直後）。再プレイと新規起動で、同じ結果になるかを比べるのに使う
const SNAP = () => {
  const scrub = o => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' && (/ms$/i.test(k) || k === 'frame')) ? undefined : v));
  return JSON.stringify({
    p: [state.player.lat, state.player.lon], spawn: [state.spawn.lat, state.spawn.lon], timeLeft: state.timeLeft,
    chests: state.chests.map(c => [c.lat, c.lon, c.item, c.state]), boards: state.hintBoards.map(b => [b.lat, b.lon, b.questionId, b.state]),
    read: state.readHintIds.size, asked: state.askedIds.size, fifty: state.fiftyFiftyStock, compass: state.compassActive, boost: state.speedBoostUntil,
    mode: state.mode, quizStep: state.quizStep, quiz: state.currentQuiz ? 1 : 0, key: gameSettings.difficultyKey,
    hud: { timer: String(timerEl.textContent), cc: String(chestCountEl.textContent), ct: String(chestTotalEl.textContent), hint: hintListBtn.textContent },
    fog: scrub(fogTileInfo())
  });
};
async function openPage(browser, dir, query, opts){
  opts = opts || {};
  const ctx = opts.context || await browser.newContext({ viewport: { width: opts.w || 390, height: opts.h || 572 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [], warns = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if(m.type() === 'error') errors.push(m.text()); if(m.type() === 'warning') warns.push(m.text()); });
  await page.addInitScript(INIT(opts.seed));
  await page.addInitScript('window.__snap = ' + SNAP.toString() + '; window.__onInit = () => { window.__initSnaps.push(window.__snap()); };');
  if(opts.reseedOnInit) await page.addInitScript('window.__reseedOnInit = ' + opts.reseedOnInit + ';');
  if(opts.markersOff) await page.addInitScript('window.__markersOff = true;');
  if(opts.force) await page.addInitScript('window.__force = ' + opts.force.toString() + ';');
  if(opts.init) await page.addInitScript(opts.init);
  if(opts.beforeGoto) await opts.beforeGoto(page);
  const qs = opts.noPref ? '?' + String(query || '').replace(/^&/, '') : '?pref=13' + (query || '');   // noPref：県の指定なし（県を自動で選ぶ）
  await page.goto(`${BASE.url}/${dir}/index.html${qs}`, opts.waitUntil ? { waitUntil: opts.waitUntil } : undefined);
  return { page, ctx, errors, warns };
}
const BASE = { url: '' };
// ループが始まる（gameStarted かつ 読み込み中の表示が消える）まで、フレームを送りながら待つ
async function waitStarted(page, settle){
  for(let i = 0; i < 3000; i++){
    await page.evaluate(() => window.__pump(1));
    if(await page.evaluate(() => typeof gameStarted !== 'undefined' && gameStarted && !document.getElementById('loadingOverlay').classList.contains('show') && !(document.getElementById('difficultyOverlay') && document.getElementById('difficultyOverlay').classList.contains('show')))) break;
    await page.waitForTimeout(10);
  }
  if(settle){ await page.waitForTimeout(1500); await page.evaluate(() => window.__pump(60)); }
}
const region = (page, x, y, w, h) => page.evaluate(([x, y, w, h]) => { const c = document.getElementById('game'); const d = c.getContext('2d').getImageData(x, y, w, h).data;
  let s = ''; const CH = 0x8000; for(let i = 0; i < d.length; i += CH) s += String.fromCharCode.apply(null, d.subarray(i, i + CH)); return btoa(s); }, [x, y, w, h]).then(b => Buffer.from(b, 'base64'));
module.exports = { chromium, serve, BASE, openPage, waitStarted, region, arg, ROOT, fs, path };
