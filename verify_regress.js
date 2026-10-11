// ======================================================================
// verify_regress.js — ③ 回帰（実ブラウザ・東京）：既存の機能が変更前(old)と同じ結果か
//   node verify_regress.js [--root <old/ new/ を含むフォルダ>]
//   old＝変更前（難易度・配置まで入った版）、new＝変更後。new は ?diff=指定で選択画面をスキップし、目印をオフ（CONFIG.SHOW_ITEM_MARKERS=false）にして比べる。
//   配置（スポーン・宝箱・掲示板）は、新旧とも initGame() の直後に同じ固定配置を差し込み、乱数を再シードして、同じ操作を行う。
//   対照として、旧を2回動かした結果も比べる（ハーネスの揺らぎの確認）。
// ======================================================================
'use strict';
const { chromium, serve, BASE, openPage, waitStarted, region, fs, path } = require('./common.js');
const REPORT = path.join(__dirname, 'verification_report.md');
const report = line => { fs.appendFileSync(REPORT, line + '\n'); console.log(line); };
const ok = v => v ? '○' : '**×**';
const j = x => JSON.stringify(x);

// 固定の配置（宝箱4・掲示板3・位置）。initGame() の直後（地形タイルを焼く前）に差し込む
const FORCE = () => {
  const lat0 = CAPITAL.lat - 0.02, lon0 = CAPITAL.lon - 0.03;
  state.player.lat = lat0; state.player.lon = lon0; state.spawn = { lat: lat0, lon: lon0 };
  const mk = (dlat, dlon, item) => ({ lat: lat0 + dlat, lon: lon0 + dlon, item, state: 'closed', openStart: 0 });
  state.chests = [mk(0.004, 0.000, 'time'), mk(0.000, 0.006, 'speed'), mk(-0.004, 0.004, 'fifty'), mk(0.006, 0.006, 'compass')];
  state.hintBoards = [[0.003, -0.004], [-0.003, -0.005], [0.008, 0.001]].map((o, i) => ({ lat: lat0 + o[0], lon: lon0 + o[1], questionId: currentKnowledge[i].id, state: 'active' }));
  state.timeLeft = 90; state.readHintIds = new Set(); state.askedIds = new Set(); state.compassActive = false; state.fiftyFiftyStock = 0; state.speedBoostUntil = 0;
  chestTotalEl.textContent = state.chests.length; chestCountEl.textContent = 0;
  resetHintUI(); resetFogTiles(); revealFogAt(worldX(lon0), worldY(lat0)); lastTime = performance.now();
};
const SETTLE = () => { state.timeLeft = 90; state.readHintIds = new Set(); state.askedIds = new Set(); resetHintUI(); timerEl.textContent = 90; window.__base = performance.now(); window.__reseed(20261010); lastTime = performance.now(); };
const SNAP = () => {
  const base = window.__base, scrub = o => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' && (/ms$/i.test(k) || k === 'frame')) ? undefined : v));
  const rel = v => v ? +(v - base).toFixed(3) : 0;
  return {
    p: [state.player.lat, state.player.lon], timeLeft: state.timeLeft,
    chests: state.chests.map(c => [c.item, c.state, rel(c.openStart)]), boards: state.hintBoards.map(b => [b.questionId, b.state]),
    read: [...state.readHintIds].sort(), asked: [...state.askedIds].sort(), fifty: state.fiftyFiftyStock, compass: state.compassActive, boost: rel(state.speedBoostUntil),
    mode: state.mode, quizStep: state.quizStep, quiz: state.currentQuiz ? JSON.parse(JSON.stringify(state.currentQuiz)) : null,
    hud: { timer: timerEl.textContent, chestCount: chestCountEl.textContent, chestTotal: chestTotalEl.textContent, hintBtn: hintListBtn.textContent, fiftyBtn: document.getElementById('fiftyFiftyBtn').className + '|' + document.getElementById('fiftyFiftyBtn').style.display },
    panels: { hint: document.getElementById('hintPanel').className, hintText: document.getElementById('hintPanel').classList.contains('show') ? document.getElementById('hintPanelText').textContent : '',
              overlays: [...document.querySelectorAll('.overlay')].filter(e => e.classList.contains('show')).map(e => e.id) },
    fog: scrub(fogTileInfo()), terrain: scrub(terrainTileInfo())
  };
};
async function scenario(browser, dir){
  const { page, ctx, errors } = await openPage(browser, dir, '&diff=normal', { force: FORCE, markersOff: true });
  await waitStarted(page, true);
  await page.evaluate(SETTLE); await page.evaluate(() => window.__pump(30));
  const snaps = [];
  const grab = async name => { const W = await page.evaluate(() => W), H = await page.evaluate(() => H); snaps.push({ name, snap: await page.evaluate(SNAP), buf: await region(page, 0, 0, W, H), W, H }); };
  await grab('開始（固定配置）');
  await page.evaluate(() => { const dts = [8, 33, 1000 / 60, 50]; keys.right = true; for(let i = 0; i < 90; i++) window.__pump(1, dts[i % 4]); keys.right = false; keys.up = true; for(let i = 0; i < 60; i++) window.__pump(1, dts[i % 4]); keys.up = false; });
  await grab('歩行・dt');
  for(let i = 0; i < 4; i++){
    await page.evaluate(i => { const c = state.chests[i]; state.player.lat = c.lat; state.player.lon = c.lon; window.__pump(4); }, i);
    await page.evaluate(() => window.__pump(12)); await grab('宝箱' + (i + 1) + '：' + ['time', 'speed', 'fifty', 'compass'][i]);
  }
  for(let i = 0; i < 3; i++){
    await page.evaluate(i => { const b = state.hintBoards[i]; state.player.lat = b.lat; state.player.lon = b.lon; window.__pump(4); }, i);
    await page.evaluate(() => window.__pump(8)); await grab('掲示板' + (i + 1));
  }
  await page.evaluate(() => { state.player.lat = state.boss.lat; state.player.lon = state.boss.lon; window.__pump(4); });
  await grab('ボス戦開始');
  await page.evaluate(() => { useFiftyFifty(); }); await grab('50-50を使用');
  for(let k = 0; k < 6; k++){
    const more = await page.evaluate(k => { if(state.mode !== 'quiz') return false; answerQuiz(k % 2 === 1 ? false : true); window.__pump(6); return true; }, k);
    if(!more) break; await page.evaluate(() => window.__pump(20)); await grab('回答' + (k + 1));
  }
  const err = errors.slice(); await ctx.close(); return { snaps, errors: err };
}
function cmp(a, b){
  const rows = []; let allSnap = true, allPx = 0;
  a.snaps.forEach((s, i) => { const t = b.snaps[i]; let px = 0; if(!t || s.buf.length !== t.buf.length) px = -1; else for(let q = 0; q < s.buf.length; q += 4) if(s.buf[q] !== t.buf[q] || s.buf[q+1] !== t.buf[q+1] || s.buf[q+2] !== t.buf[q+2]) px++;
    const sn = t && j(s.snap) === j(t.snap); if(!sn) allSnap = false; if(px !== 0) allPx += Math.max(px, 1);
    rows.push({ name: s.name, snap: sn, px, diffKeys: sn ? [] : Object.keys(s.snap).filter(k => !t || j(s.snap[k]) !== j(t.snap[k])) }); });
  return { rows, allSnap, allPx };
}

(async () => {
  const server = await serve(); BASE.url = 'http://localhost:' + server.address().port;
  const browser = await chromium.launch();
  const ONLY = require('./common.js').arg('only', 'ab');
  if(ONLY.includes('a')){
    report('## ③ 回帰（実ブラウザ・東京）— 既存の機能が変更前と同じ結果');
    report('new は ?diff=normal（選択画面をスキップ）＋目印オフ（CONFIG.SHOW_ITEM_MARKERS=false）。固定の配置（宝箱4・掲示板3・位置）を、新旧とも initGame() の直後（地形タイルを焼く前）に同じく差し込み、乱数を再シード、同じ操作：');
    report('歩行（dt 8/33/16.7/50ms 交互）→宝箱4個（⏱+10秒・👟・✂️・🧭）→掲示板3枚→県庁でクイズ→✂️50-50→正解・不正解（-15秒）。');
    report('各段階で、状態（位置・時間・宝箱・掲示板・読了・50-50・県庁サーチ・クイズ・HUD・パネル）、霧タイル・地形タイルの情報、キャンバス全画素（ミニマップ含む）を比べる。\n');
    const o1 = await scenario(browser, 'old'), o2 = await scenario(browser, 'old'), n1 = await scenario(browser, 'new');
    const ctl = cmp(o1, o2), r = cmp(o1, n1);
    report('| 段階 | 状態の一致 | 画面の差のある画素 | （対照：旧を2回）状態 | （対照）画素 |'); report('|---|---|---|---|---|');
    r.rows.forEach((x, i) => report(`| ${x.name} | ${x.snap ? '一致' : '**不一致**(' + x.diffKeys.join(',') + ')'} | **${x.px}** | ${ctl.rows[i].snap ? '一致' : '不一致(' + ctl.rows[i].diffKeys.join(',') + ')'} | ${ctl.rows[i].px} |`));
    report(`\n- 結果：全${r.rows.length}段階で、状態が一致 = **${r.allSnap}**、画面の差のある画素の合計 = **${r.allPx}**（対照の旧×2回：状態 ${ctl.allSnap}、画素 ${ctl.allPx}）。ページのエラー：旧 ${o1.errors.length + o2.errors.length}件、新 ${n1.errors.length}件 ${n1.errors.slice(0, 2).join(' | ')}\n`);
    // 目印オン／オフの違いは、目印の描画だけ（同じ操作の途中で、オンの画面とオフの画面を比べると、差は目印の周囲に限られる）
  }
  if(ONLY.includes('b')){
    report('## ③b 起動確認（県選択・難易度・配置）— new を選択画面なしで起動');
    report('| 起動の条件 | 起動する | 県（loadedPrefCode） | 難易度 / モード | 宝箱 | 掲示板 | timeLeft | HUD時間 | スポーン実距離(km) / 範囲 | 配置が県内・良い地形・間隔・距離を満たす | 警告 |');
    report('|---|---|---|---|---|---|---|---|---|---|---|');
    const cases = [['&diff=normal', '?pref=13&diff=normal', false], ['&diff=easy', '?pref=13&diff=easy', false], ['&diff=veryhard&scatter=reachable', '?pref=13&diff=veryhard&scatter=reachable', false], ['&diff=hard', '?pref=13&diff=hard', false], ['&diff=normal', '（?pref なし。県を自動で選ぶ）&diff=normal', true]];
    for(const [q, label, noPref] of cases){
      const { page, ctx, errors, warns } = await openPage(browser, 'new', q, { noPref });
      await waitStarted(page, false);
      const r = await page.evaluate(() => {
        const diff = gameSettings.difficulty, okT = (lat, lon) => { const c = getLanduseCode(lat, lon); if(c === null || c === undefined) return false; const n = Number(c); return n >= 1 && n !== 14 && n !== 15 && n !== 16; };
        const si = state.spawnInfo; const pts = state.hintBoards.concat(state.chests); let ok = true, reachBad = 0;
        pts.forEach((p, a) => { if(!isInsidePrefecture(p.lat, p.lon) || !okT(p.lat, p.lon)) ok = false;
          if(kmBetween(state.spawn.lat, state.spawn.lon, p.lat, p.lon) < 0.3 - 1e-9 || kmBetween(CAPITAL.lat, CAPITAL.lon, p.lat, p.lon) < 0.5 - 1e-9) ok = false;
          if(gameSettings.scatterMode === 'reachable' && kmBetween(state.spawn.lat, state.spawn.lon, p.lat, p.lon) > diff.spawnMaxKm * 1.3 + 1e-6) reachBad++;
          for(let b = a + 1; b < pts.length; b++) if(kmBetween(p.lat, p.lon, pts[b].lat, pts[b].lon) < 0.8 * Math.pow(0.8, 5) - 1e-9) ok = false; });
        const t0 = JSON.parse(window.__initSnaps[0]);
        return { started: gameStarted && !document.getElementById('loadingOverlay').classList.contains('show'), pref: loadedPrefCode, key: gameSettings.difficultyKey, mode: gameSettings.scatterMode,
          nc: state.chests.length, want: diff.chestCount, nb: state.hintBoards.length, t: t0.timeLeft, hud: t0.hud.timer, d: si.distKm, lo: si.lo, hi: si.hi, placeOK: ok && reachBad === 0 && si.stage === 0 && !si.relaxed,
          selectShown: document.getElementById('difficultyOverlay').classList.contains('show') };
      });
      report(`| ${label} | ${ok(r.started && !r.selectShown)} | ${r.pref} | ${r.key} / ${r.mode} | ${ok(r.nc === r.want)} ${r.nc}(${r.want}) | ${ok(r.nb === 20)} ${r.nb} | ${ok(r.t === 120)} ${r.t} | ${r.hud} | ${r.d.toFixed(1)} / ${r.lo.toFixed(1)}〜${r.hi.toFixed(1)} | ${ok(r.placeOK)} | ${warns.length}件 エラー${errors.length} |`);
      await ctx.close();
    }
    report('');
  }
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
