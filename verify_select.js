// ======================================================================
// verify_select.js — ① 難易度の選択画面の検証（実ブラウザ Chromium + Playwright・東京）
//   node verify_select.js [--root <old/ new/ newoff/ を含むフォルダ>]
//   new＝変更後、newoff＝new の CONFIG.SHOW_DIFFICULTY_SELECT を false にしたコピー（検証用）
//   結果は verification_report.md に追記、スクリーンショットは out/ に出す。
// ======================================================================
'use strict';
const { chromium, serve, BASE, openPage, waitStarted, region, fs, path } = require('./common.js');
const REPORT = path.join(__dirname, 'verification_report.md'), OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const report = line => { fs.appendFileSync(REPORT, line + '\n'); console.log(line); };
const KEYS = ['EASY', 'NORMAL', 'HARD', 'VERYHARD'], CHESTS = { EASY: 14, NORMAL: 10, HARD: 6, VERYHARD: 3 };
const DESC = { EASY: '県庁が近い・宝箱が多い', NORMAL: 'ふつう', HARD: '県庁が遠い・宝箱が少ない', VERYHARD: '県庁がかなり遠い・宝箱がごくわずか' };
const ok = v => v ? '○' : '**×**';
const waitEnabled = page => page.waitForFunction(() => { const b = document.querySelector('.diffBtn'); return b && !b.disabled; }, null, { polling: 100, timeout: 20000 });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

(async () => {
  const server = await serve(); BASE.url = 'http://localhost:' + server.address().port;
  const browser = await chromium.launch();
  if(!process.argv.includes('--append')) fs.writeFileSync(REPORT, '# verification_report.md — 難易度の選択画面・宝箱／掲示板の目印\n\n実ブラウザ Chromium 141（Playwright）、画面 390×572（一部 390×844）。乱数・時間・フレーム送りはページ内で固定。new＝変更後。\n\n');
  report('## ① 難易度の選択画面');

  // ---------- 1) 起動時：読み込み中 → 選べる状態、見た目、表示内容 ----------
  {
    const { page, ctx, errors } = await openPage(browser, 'new', '', { waitUntil: 'commit', beforeGoto: async p => { await p.route('**/data/pref13/data_mesh.js', async r => { await new Promise(s => setTimeout(s, 2500)); r.continue(); }); } });
    await page.waitForFunction(() => document.getElementById('diffStatus') && document.querySelectorAll('.diffBtn').length === 4, null, { polling: 50 });
    await page.waitForTimeout(300);
    const loading = await page.evaluate(() => ({ shown: document.getElementById('difficultyOverlay').classList.contains('show'), status: document.getElementById('diffStatus').textContent,
      disabled: [...document.querySelectorAll('.diffBtn')].map(b => b.disabled), started: (typeof gameStarted !== 'undefined' && gameStarted), loadingShown: document.getElementById('loadingOverlay').classList.contains('show') }));
    // 読み込み中にボタンを押しても何も起きない（disabled のボタンは click が発火しない）
    await page.evaluate(() => document.querySelectorAll('.diffBtn').forEach(b => b.click()));
    const notStarted = await page.evaluate(() => Object.keys(state).length === 0 && typeof gameStarted !== 'undefined' && !gameStarted);
    await shot(page, 'select_1_loading.png');
    await waitEnabled(page);
    await shot(page, 'select_2_ready.png');
    const ready = await page.evaluate(() => {
      const ov = document.getElementById('difficultyOverlay'), app = document.getElementById('app'), r = e => e.getBoundingClientRect();
      const btns = [...document.querySelectorAll('.diffBtn')], descs = [...document.querySelectorAll('.diffDesc')];
      const text = ov.innerText;
      return { status: document.getElementById('diffStatus').textContent, names: btns.map(b => b.textContent), heights: btns.map(b => Math.round(r(b).height)), widths: btns.map(b => Math.round(r(b).width)),
        descs: descs.map(d => d.textContent), enabled: btns.every(b => !b.disabled), covers: Math.abs(r(ov).width - r(app).width) < 1 && Math.abs(r(ov).height - r(app).height) < 1 && r(ov).top === r(app).top,
        title: ov.querySelector('h1').textContent, hasDigit: /[0-9０-９]/.test(text), hasKm: /km|ＫＭ|キロ/i.test(text), hasPref: /東京|都道府県コード|pref|13/.test(text.replace('都道府県サバイバルRPG（仮）', '')),
        loadingShown: document.getElementById('loadingOverlay').classList.contains('show'), noLast: !document.querySelector('.diffBtn.last'), fonts: getComputedStyle(ov).fontFamily };
    });
    // 画面全体に、県名・県コード・距離が出ていないこと（HUD・ボタン・オーバーレイの文字。クイズ文は対象外）
    const visibleText = await page.evaluate(() => document.getElementById('hud').innerText + '\n' + document.getElementById('difficultyOverlay').innerText);
    const externalRes = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).filter(n => /fonts\.|googleapis|cdn|https?:\/\/(?!localhost)/.test(n)));
    report('| 確認（起動時・読み込み中→選択可） | 結果 |'); report('|---|---|');
    report(`| 読み込み中：選択画面が出て「読み込み中…」、4つのボタンはすべて押せない（disabled）／別の読み込み画面は出ていない | ${ok(loading.shown && loading.status === '読み込み中…' && loading.disabled.length === 4 && loading.disabled.every(Boolean) && !loading.loadingShown && !loading.started)} （表示 ${loading.status}） |`);
    report(`| 読み込み中にボタンを押しても何も起きない（ゲーム未開始のまま） | ${ok(notStarted)} |`);
    report(`| 読み込み後：押せる状態になり、案内文が「${ready.status}」に変わる | ${ok(ready.enabled)} |`);
    report(`| ボタンは縦に4つ、EASY／NORMAL／HARD／VERYHARD の順 | ${ok(JSON.stringify(ready.names) === JSON.stringify(KEYS))} |`);
    report(`| 各ボタンの高さ（px、56以上）／幅（px） | ${ok(ready.heights.every(h => h >= 56))} 高さ ${ready.heights.join('/')}、幅 ${ready.widths.join('/')} |`);
    report(`| ボタンの下のひと言が指定どおり（数値なし） | ${ok(KEYS.every((k, i) => ready.descs[i] === DESC[k]))} |`);
    report(`| タイトル「都道府県サバイバルRPG（仮）」 | ${ok(ready.title === '都道府県サバイバルRPG（仮）')} |`);
    report(`| アプリ全体（HUD・操作ボタンも含む）を覆う全画面 | ${ok(ready.covers)} |`);
    report(`| 選択画面の文字に、数字・km・県名・県コードが無い／HUD＋選択画面の文字に「東京」「km」「pref」が無い | ${ok(!ready.hasDigit && !ready.hasKm && !ready.hasPref && !/東京|km|pref/i.test(visibleText))} |`);
    report(`| 前回の保存が無い時は、どのボタンも目立たせない | ${ok(ready.noLast)} |`);
    report(`| 外部フォント・外部画像・外部通信なし（localhost 以外へのリソース要求） | ${ok(externalRes.length === 0)} ${externalRes.slice(0, 2).join(',')} |`);
    report(`| ページのエラー | ${ok(errors.length === 0)} ${errors.slice(0, 2).join(' | ')} |`);
    report('');
    await ctx.close();
  }

  // ---------- 2) 4つのボタン：それぞれの宝箱数・掲示板20・制限時間120 ----------
  report('| ボタン | 宝箱(期待) | 宝箱数 | 掲示板 | timeLeft | HUDの時間 | HUDの宝箱数 | 難易度 | 開始後（120フレーム）|'); report('|---|---|---|---|---|---|---|---|---|');
  for(const key of KEYS){
    const { page, ctx, errors } = await openPage(browser, 'new', '');
    await waitEnabled(page);
    await page.click('.diff-' + key);
    const snap = JSON.parse(await page.evaluate(() => window.__initSnaps[window.__initSnaps.length - 1]));   // initGame の直後（最初のフレームより前）
    await waitStarted(page, false);
    await page.evaluate(() => window.__pump(120));
    const after = await page.evaluate(() => ({ running: state.running, mode: state.mode, t: state.timeLeft, dOv: document.getElementById('difficultyOverlay').classList.contains('show'), lOv: document.getElementById('loadingOverlay').classList.contains('show') }));
    if(key === 'EASY') await shot(page, 'select_3_started_EASY.png');
    report(`| ${key} | ${CHESTS[key]} | ${ok(snap.chests.length === CHESTS[key])} ${snap.chests.length} | ${ok(snap.boards.length === 20)} ${snap.boards.length} | ${ok(snap.timeLeft === 120)} ${snap.timeLeft} | ${snap.hud.timer} | ${snap.hud.ct} | ${ok(snap.key === key)} ${snap.key} | ${ok(after.running && after.mode === 'playing' && !after.dOv && !after.lOv)} 残り ${Math.round(after.t)}秒 エラー${errors.length} |`);
    await ctx.close();
  }
  report('');

  // ---------- 3) 選択画面を出さない場合 ----------
  report('| 起動の条件 | 選択画面が出ない | ゲームが始まる | 難易度 / 宝箱 / timeLeft | 警告 |'); report('|---|---|---|---|---|');
  for(const [dir, q, label] of [['new', '&diff=xxx', '?diff=xxx（不正な値）'], ['new', '&diff=easy', '?diff=easy'], ['new', '&diff=VERYHARD', '?diff=VERYHARD（大文字）'], ['newoff', '', 'CONFIG.SHOW_DIFFICULTY_SELECT=false（URL指定なし）']]){
    const { page, ctx, errors, warns } = await openPage(browser, dir, q);
    await page.waitForTimeout(200);
    const early = await page.evaluate(() => document.getElementById('difficultyOverlay').classList.contains('show'));
    await waitStarted(page, false);
    const r = await page.evaluate(() => ({ dOv: document.getElementById('difficultyOverlay').classList.contains('show'), started: gameStarted && !document.getElementById('loadingOverlay').classList.contains('show'), key: gameSettings.difficultyKey, n: state.chests.length, t: JSON.parse(window.__initSnaps[0]).timeLeft }));
    report(`| ${label} | ${ok(!early && !r.dOv)} | ${ok(r.started)} | ${r.key} / ${r.n} / ${r.t} | ${warns.filter(w => w.includes('[settings]')).length}件 エラー${errors.length} |`);
    if(q === '' && dir === 'newoff'){
      // 選択画面を出さない設定での再プレイ：選択画面に戻らず、同じ難易度ですぐ再開する
      await page.evaluate(() => window.__pump(5)); await page.evaluate(() => endGame(false)); await page.click('#gameOverOverlay .bigbtn');
      const rp = await page.evaluate(() => ({ dOv: document.getElementById('difficultyOverlay').classList.contains('show'), n: window.__initSnaps.length, snap: JSON.parse(window.__initSnaps[window.__initSnaps.length - 1]) }));
      report(`| └ 同上で、ゲームオーバー後に「もう一度プレイ」 | ${ok(!rp.dOv)} | ${ok(rp.n === 2)} | ${rp.snap.key} / ${rp.snap.chests.length} / ${rp.snap.timeLeft} | 選択画面に戻らず、同じ難易度ですぐ再開 |`);
    }
    await ctx.close();
  }
  report('');

  // ---------- 4) 再プレイ：選択画面に戻る → 別の難易度。連続で選んでも状態が引き継がれない ----------
  {
    const SEED = 777;
    // 新規起動（?diff=指定）で同じシードの initGame の直後の状態を取っておく（比べる相手）
    const fresh = {}; const freshMini = {};
    for(const key of KEYS){
      const { page, ctx } = await openPage(browser, 'new', '&diff=' + key, { reseedOnInit: SEED });
      await waitStarted(page, true);
      fresh[key] = JSON.parse(await page.evaluate(() => window.__initSnaps[0]));
      freshMini[key] = await region(page, 390 - 92 - 12, 12, 92, 92);
      await ctx.close();
    }
    const { page, ctx, errors } = await openPage(browser, 'new', '', { reseedOnInit: SEED });
    await waitEnabled(page);
    const seq = ['EASY', 'HARD', 'VERYHARD', 'NORMAL', 'EASY', 'VERYHARD', 'HARD'];
    report('連続の再プレイ（各回：宝箱を取る・掲示板を読む・県庁サーチ・歩いて霧を晴らす→終了→「もう一度プレイ」→選択画面→次の難易度）。選んだ直後の状態を、同じシードで新規起動した状態（?diff=指定）と比べる。\n');
    report('| 回 | 選んだ難易度 | 選択画面に戻る | 終了画面は閉じる | 前回のボタンを目立たせる | 状態が新規起動と完全一致 | 霧タイル情報が一致 | HUD（時間・宝箱・ヒント） | ミニマップの画素差 | 宝箱数 | 掲示板 | timeLeft |');
    report('|---|---|---|---|---|---|---|---|---|---|---|---|');
    let prev = null;
    for(let i = 0; i < seq.length; i++){
      const key = seq[i];
      let backOk = true, closedOk = true, lastOk = true;
      if(i > 0){
        // 前のランを遊んだ状態にして終了（引き継ぎの確認のため、状態を汚す）
        await page.evaluate(() => {
          const c = state.chests[0]; state.player.lat = c.lat; state.player.lon = c.lon; window.__pump(30);
          const b = state.hintBoards[0]; state.player.lat = b.lat; state.player.lon = b.lon; window.__pump(10);
          if(state.chests.some(x => x.item === 'compass' && x.state === 'closed')) activateCompass(); else activateCompass();
          keys.right = true; for(let k = 0; k < 40; k++) window.__pump(1); keys.right = false;
        });
        const dirty = await page.evaluate(() => ({ read: state.readHintIds.size, compass: state.compassActive, fog: fogTileInfo() }));
        const won = (i % 2 === 0);
        await page.evaluate(w => endGame(w), won);
        const ovShown = await page.evaluate(() => ({ go: document.getElementById('gameOverOverlay').classList.contains('show'), cl: document.getElementById('clearOverlay').classList.contains('show') }));
        await page.click(won ? '#clearOverlay .bigbtn' : '#gameOverOverlay .bigbtn');
        const back = await page.evaluate(() => ({ d: document.getElementById('difficultyOverlay').classList.contains('show'), go: document.getElementById('gameOverOverlay').classList.contains('show'), cl: document.getElementById('clearOverlay').classList.contains('show'),
          dis: [...document.querySelectorAll('.diffBtn')].some(b => b.disabled), last: [...document.querySelectorAll('.diffBtn.last')].map(b => b.dataset.diff), status: document.getElementById('diffStatus').textContent }));
        backOk = back.d && !back.dis; closedOk = !back.go && !back.cl && (won ? ovShown.cl : ovShown.go); lastOk = back.last.length === 1 && back.last[0] === prev;
        if(i === 1) await shot(page, 'select_4_replay.png');
        if(!(dirty.read >= 1 && dirty.compass)) report(`- 注意：第${i}回の遊び方の準備が不十分（読了 ${dirty.read}、県庁サーチ ${dirty.compass}）`);
      }
      await page.click('.diff-' + key);
      const snap = JSON.parse(await page.evaluate(() => window.__initSnaps[window.__initSnaps.length - 1]));
      await page.evaluate(() => window.__pump(3));
      const mini = await region(page, 390 - 92 - 12, 12, 92, 92);
      let px = 0; for(let q = 0; q < mini.length; q += 4) if(mini[q] !== freshMini[key][q] || mini[q + 1] !== freshMini[key][q + 1] || mini[q + 2] !== freshMini[key][q + 2]) px++;
      const f = fresh[key], same = JSON.stringify(snap) === JSON.stringify(f), fogSame = JSON.stringify(snap.fog) === JSON.stringify(f.fog);
      const extra = await page.evaluate(() => ({ boost: document.getElementById('boostHud').classList.contains('show'), hintPanel: document.getElementById('hintPanel').classList.contains('show'), quiz: document.getElementById('quizOverlay').classList.contains('show'),
        dOv: document.getElementById('difficultyOverlay').classList.contains('show'), go: document.getElementById('gameOverOverlay').classList.contains('show'), cl: document.getElementById('clearOverlay').classList.contains('show') }));
      const hudOk = snap.hud.timer === '120' && snap.hud.cc === '0' && snap.hud.ct === String(CHESTS[key]) && /ヒント\(0\)/.test(snap.hud.hint) && !extra.boost && !extra.hintPanel && !extra.quiz && !extra.dOv && !extra.go && !extra.cl;
      report(`| ${i + 1} | ${key} | ${i === 0 ? '（起動）' : ok(backOk)} | ${i === 0 ? '-' : ok(closedOk)} | ${i === 0 ? '-' : ok(lastOk)} | ${ok(same)} | ${ok(fogSame)} | ${ok(hudOk)} | ${px} | ${snap.chests.length} | ${snap.boards.length} | ${snap.timeLeft} |`);
      await waitStarted(page, false);
      prev = key;
    }
    report(`\n- 連続${seq.length}回の再プレイを通じて、ページのエラー ${errors.length} 件。\n`);
    await ctx.close();
  }

  // ---------- 5) localStorage ----------
  report('| localStorage の状況 | 結果 |'); report('|---|---|');
  {
    // (a) 保存と、次回の目立たせ方（同じブラウザコンテキスト＝同じ保存領域）
    const bctx = await browser.newContext({ viewport: { width: 390, height: 572 }, deviceScaleFactor: 1 });
    let r1 = await openPage(browser, 'new', '', { context: bctx }); await waitEnabled(r1.page); await r1.page.click('.diff-HARD');
    const saved = await r1.page.evaluate(() => window.localStorage.getItem(CONFIG.DIFFICULTY_STORAGE_KEY)); await r1.page.close();
    let r2 = await openPage(browser, 'new', '', { context: bctx }); await waitEnabled(r2.page);
    const last = await r2.page.evaluate(() => [...document.querySelectorAll('.diffBtn.last')].map(b => b.dataset.diff + ':' + b.querySelector('.diffLast').textContent));
    await shot(r2.page, 'select_5_last_HARD.png');
    await r2.page.click('.diff-EASY'); const saved2 = await r2.page.evaluate(() => window.localStorage.getItem(CONFIG.DIFFICULTY_STORAGE_KEY)); await r2.page.close();
    report(`| 選ぶと保存される（HARD→保存値 ${saved}、次に EASY→保存値 ${saved2}） | ${ok(saved === 'HARD' && saved2 === 'EASY')} |`);
    report(`| 次回の起動で、前回のボタンだけが目立つ（HARD） | ${ok(last.length === 1 && last[0].startsWith('HARD'))} ${last.join(',')} |`);
    // (b) 壊れた値・小文字の値
    for(const [val, expect] of [['xxx', null], ['veryhard', 'VERYHARD'], ['', null]]){
      const c2 = await browser.newContext({ viewport: { width: 390, height: 572 }, deviceScaleFactor: 1 });
      const p0 = await openPage(browser, 'new', '', { context: c2, init: `try{ window.localStorage.setItem('prefSurvival.lastDifficulty', ${JSON.stringify(val)}); }catch(e){}` });
      await waitEnabled(p0.page);
      const l = await p0.page.evaluate(() => [...document.querySelectorAll('.diffBtn.last')].map(b => b.dataset.diff));
      report(`| 保存値が「${val}」の時 | ${ok((expect === null && l.length === 0) || (l.length === 1 && l[0] === expect))} 目立つボタン：${l.join(',') || 'なし'}、エラー${p0.errors.length} |`);
      await c2.close();
    }
    await bctx.close();
    // (c) 使えない状況（アクセスで例外／getItem・setItem が例外）
    for(const [label, init] of [['localStorage へのアクセス自体が例外（SecurityError）', `Object.defineProperty(window, 'localStorage', { get(){ throw new DOMException('denied', 'SecurityError'); } });`],
                                ['getItem・setItem が例外を投げるスタブ', `Object.defineProperty(window, 'localStorage', { value: { getItem(){ throw new Error('x'); }, setItem(){ throw new Error('y'); } } });`]]){
      const { page, ctx, errors } = await openPage(browser, 'new', '', { init });
      await waitEnabled(page);
      const noLast = await page.evaluate(() => !document.querySelector('.diffBtn.last'));
      await page.click('.diff-NORMAL'); await waitStarted(page, false); await page.evaluate(() => window.__pump(60));
      const run = await page.evaluate(() => ({ running: state.running, n: state.chests.length, t: Math.round(state.timeLeft) }));
      report(`| ${label}：選択画面が出て、選ぶとゲームが始まる | ${ok(noLast && run.running && run.n === 10)} 宝箱${run.n}・残り${run.t}秒・ページのエラー${errors.length}件 |`);
      await ctx.close();
    }
  }
  report('');

  // ---------- 6) 読み込み失敗時：現状どおりエラー表示のみ ----------
  {
    const { page, ctx } = await openPage(browser, 'new', '', { beforeGoto: async p => { await p.route('**/data/pref13/data_mesh.js', r => r.abort()); } });
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => ({ dOv: document.getElementById('difficultyOverlay').classList.contains('show'), lOv: document.getElementById('loadingOverlay').classList.contains('show'), msg: document.getElementById('loadingMsg').textContent,
      started: typeof gameStarted !== 'undefined' && gameStarted }));
    await shot(page, 'select_6_error.png');
    report(`| 読み込み失敗：選択画面は閉じ、エラー表示のみ（ゲームは始まらない） | ${ok(!r.dOv && r.lOv && /読み込みに失敗/.test(r.msg) && !r.started)} 「${r.msg}」 |`);
    await ctx.close();
  }
  // 背の高い画面（390×844）のスクリーンショット
  {
    const { page, ctx } = await openPage(browser, 'new', '', { w: 390, h: 844 }); await waitEnabled(page); await shot(page, 'select_7_ready_390x844.png'); await ctx.close();
  }
  report('');
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
