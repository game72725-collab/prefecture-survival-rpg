// ======================================================================
// verify_markers.js — ② 宝箱・掲示板の目印の検証（実ブラウザ Chromium + Playwright・東京の実データ）
//   node verify_markers.js [--root <new/ を含むフォルダ>]
//   結果は verification_report.md に追記、スクリーンショットは out/ に出す。
// ======================================================================
'use strict';
const { chromium, serve, BASE, openPage, region, fs, path } = require('./common.js');
const REPORT = path.join(__dirname, 'verification_report.md'), OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const report = line => { fs.appendFileSync(REPORT, line + '\n'); console.log(line); };
const ok = v => v ? '○' : '**×**';
const W = 390, H = 344;
const GOLD = [0xFF, 0xC4, 0x00], MAGENTA = [0xFF, 0x2D, 0x95];
const cpng = (page, name) => page.evaluate(() => document.getElementById('game').toDataURL('image/png')).then(d => fs.writeFileSync(path.join(OUT, name), Buffer.from(d.split(',')[1], 'base64')));
const px = (b, w, x, y) => { const i = (y * w + x) * 4; return [b[i], b[i + 1], b[i + 2]]; };
const near = (a, b, t) => Math.abs(a[0] - b[0]) <= t && Math.abs(a[1] - b[1]) <= t && Math.abs(a[2] - b[2]) <= t;
// Lab 色差 (CIE76)
const lab = c => { const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; const r = f(c[0]), g = f(c[1]), b = f(c[2]);
  let x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = (0.2126 * r + 0.7152 * g + 0.0722 * b), z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const t = v => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116; return [116 * t(y) - 16, 500 * (t(x) - t(y)), 200 * (t(y) - t(z))]; };
const dE = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// ページ内ヘルパー（FORCE で定義）：ワールドpx のずらしで緯度経度を動かす、地形コードの近傍判定、固定配置
const SETUP = () => {
  window.__off = (lat, lon, dx, dy) => { const sx = worldX(lon + 1) - worldX(lon), sy = worldY(lat + 1) - worldY(lat); return { lat: lat + dy / sy, lon: lon + dx / sx }; };
  window.__code = (lat, lon) => getLanduseCode(lat, lon);
};

(async () => {
  const server = await serve(); BASE.url = 'http://localhost:' + server.address().port;
  const browser = await chromium.launch();
  report('## ② 宝箱・掲示板の目印');

  // ================= ページを開く（?diff=normal で選択画面を出さない） =================
  const { page, ctx, errors } = await openPage(browser, 'new', '&diff=normal', { force: SETUP });
  for(let i = 0; i < 3000; i++){ await page.evaluate(() => window.__pump(1)); if(await page.evaluate(() => typeof gameStarted !== 'undefined' && gameStarted && !document.getElementById('loadingOverlay').classList.contains('show'))) break; await page.waitForTimeout(10); }
  await page.waitForTimeout(1500); await page.evaluate(() => window.__pump(60));
  const cfg = await page.evaluate(() => ({ size: CONFIG.MARKER_SIZE_PX, gap: CONFIG.MARKER_GAP_PX, bob: CONFIG.MARKER_BOB_PX, period: CONFIG.MARKER_BOB_PERIOD_MS, chestH: CONFIG.CHEST_SIZE, boardH: CONFIG.HINT_BOARD_SIZE, foot: CHEST_SIZE_PX / 2,
    chestColor: CONFIG.MARKER_CHEST_COLOR, boardColor: CONFIG.MARKER_BOARD_COLOR, show: CONFIG.SHOW_ITEM_MARKERS }));

  // ================= 背景ごとの目標地点を探す（実データ） =================
  // 鉄道：ゲーム側は初期化後に RAIL_ROUTES を解放する（null）ので、データファイルを直接読んで、線の途中の頂点（線が目印の背後を通る）を候補にする
  const vm = require('vm'); const rsb = {}; vm.runInNewContext(fs.readFileSync(path.join(require('./common.js').ROOT, 'new/data/pref13/rail_data.js'), 'utf8'), rsb);
  const railCands = [];
  for(const t of [1, 2, 3]){
    let n = 0;
    for(const r of rsb.RAIL_ROUTES){ const ty = (r.operatorType === 1) ? 1 : (r.operatorType === 2 ? 2 : 3); if(ty !== t || r.coords.length < 20) continue;
      for(const f of [0.3, 0.5, 0.7]){ const c = r.coords[Math.floor(r.coords.length * f)]; railCands.push([c[0], c[1], t]); } if(++n >= 12) break; }
  }
  const targets = await page.evaluate((railCands) => {
    const ringLons = PREFECTURE_RING.map(q => q[0]), ringLats = PREFECTURE_RING.map(q => q[1]);
    const lo0 = Math.min(...ringLons), lo1 = Math.max(...ringLons), la0 = Math.min(...ringLats), la1 = Math.max(...ringLats);
    const offs = [[0, 0], [-8, 0], [8, 0], [0, -8], [0, 8], [-8, -8], [8, 8], [-8, 8], [8, -8]];
    const codesAt = (lat, lon) => offs.map(o => { const p = window.__off(lat, lon, o[0], o[1]); return getLanduseCode(p.lat, p.lon); });
    const out = { forest: [], urban: [], water: [], coast: [], rail: [] };
    const step = 0.004;
    for(let lat = la0; lat <= la1; lat += step) for(let lon = lo0; lon <= lo1; lon += step){
      if(!isInsidePrefecture(lat, lon)) continue;
      const cs = codesAt(lat, lon);
      if(cs.some(c => c === null || c === undefined)) continue;
      if(out.forest.length < 2 && cs.every(c => c === '3')) out.forest.push([lat, lon]);
      else if(out.urban.length < 2 && cs.every(c => c === '7' || c === '8')) out.urban.push([lat, lon]);
      else if(out.water.length < 2 && cs.every(c => c === '14')) out.water.push([lat, lon]);
      else if(out.coast.length < 2 && cs.filter(c => c === '16').length >= 3 && cs.filter(c => c !== '16' && c !== '15').length >= 3) out.coast.push([lat, lon]);
    }
    // 鉄道：県内の候補から、種類ごと（1=新幹線・2=JR・3=私鉄）に最初の1つ
    const rp = {}; railCands.forEach(c => { if(!rp[c[2]] && isInsidePrefecture(c[0], c[1])) rp[c[2]] = c; }); out.rail = Object.values(rp);
    return out;
  }, railCands);
  report(`目標地点（実データ・東京）の数：森林 ${targets.forest.length}、市街地 ${targets.urban.length}、河川 ${targets.water.length}、海岸 ${targets.coast.length}、鉄道 ${targets.rail.length}（鉄道の種類 ${targets.rail.map(r => r[2]).join(',')}）。`);

  // ================= 1) 背景×ズームのスクリーンショットと、目印の見え方の測定 =================
  const ZOOMS = [1.0, 1.7, 3.5];
  const cats = [['森', targets.forest[0]], ['水（河川）', targets.water[0]], ['市街地', targets.urban[0]], ['海岸', targets.coast[0]], ['鉄道（新幹線・赤）', targets.rail.find(r => r[2] === 1)], ['鉄道（JR・緑）', targets.rail.find(r => r[2] === 2)], ['鉄道（私鉄・紫）', targets.rail.find(r => r[2] === 3)]].filter(c => c[1]);
  const shots = []; const rows = []; const sizes = {};
  const canvasSize = await page.evaluate(() => [W, H]);
  const Wc = canvasSize[0], Hc = canvasSize[1];
  const evalPlace = (kind, T, z) => page.evaluate(([kind, T, z, cfg]) => {
    const H_ = H, W_ = W;
    const foot = window.__off(T[0], T[1], 0, (cfg.chestH - cfg.foot) + (cfg.gap + cfg.size / 2) / z);
    const cam = window.__off(T[0], T[1], 0.22 * W_ / z, 0.05 * H_ / z);   // 目印の中心 T を画面の左寄り(28%,45%)に置き、プレイヤー（画面中央）から離す
    resetFogTiles(); state.chests = []; state.hintBoards = []; state.compassActive = false; state.timeLeft = 120;
    if(kind === 'chest') state.chests = [{ lat: foot.lat, lon: foot.lon, item: 'time', state: 'closed', openStart: 0 }];
    else state.hintBoards = [{ lat: foot.lat, lon: foot.lon, questionId: currentKnowledge[0].id, state: 'active' }];
    state.player.lat = cam.lat; state.player.lon = cam.lon; setCameraZoom(z);
    [T, [foot.lat, foot.lon], [cam.lat, cam.lon]].forEach(q => revealFogAt(worldX(q[1]), worldY(q[0])));
    window.__pump(50);
    const t = window.__getVT(); window.__setVT(Math.ceil(t / cfg.period) * cfg.period - 1000 / 60);
    window.__pump(1);
    const pWX = worldX(state.player.lon), pWY = worldY(state.player.lat);
    const o = (kind === 'chest') ? state.chests[0] : state.hintBoards[0];
    const sx = worldX(o.lon), sy = worldY(o.lat), topY = sy + cfg.foot - (kind === 'chest' ? cfg.chestH : cfg.boardH);
    return { x: W_ / 2 + (sx - pWX) * z, y: H_ / 2 + (topY - pWY) * z - cfg.gap - cfg.size / 2, tipY: H_ / 2 + (topY - pWY) * z - cfg.gap };
  }, [kind, T, z, cfg]);

  report('\n| 背景 | ズーム | 種類 | 塗りの画素数 | 白の縁(画素) | 暗い縁(画素) | 塗りの外接矩形(幅×高) | 中心の位置ずれ(px) | 周囲の背景との色差ΔE | はっきり見える |');
  report('|---|---|---|---|---|---|---|---|---|---|');
  for(const [cname, T] of cats){
    for(const z of ZOOMS){
      for(const kind of ['chest', 'board']){
        const e = await evalPlace(kind, T, z);
        const buf = await region(page, 0, 0, Wc, Hc);
        const fill = kind === 'chest' ? GOLD : MAGENTA;
        const R = 22; let nF = 0, nW = 0, nB = 0, minx = 1e9, maxx = -1, miny = 1e9, maxy = -1, sx = 0, sy = 0;
        const bg = [];
        for(let y = Math.max(0, Math.floor(e.y - R)); y <= Math.min(Hc - 1, Math.ceil(e.y + R)); y++) for(let x = Math.max(0, Math.floor(e.x - R)); x <= Math.min(Wc - 1, Math.ceil(e.x + R)); x++){
          const c = px(buf, Wc, x, y);
          if(near(c, fill, 2)){ nF++; sx += x + 0.5; sy += y + 0.5; minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
          else if(near(c, [255, 255, 255], 2)) nW++;
          else if(Math.max(c[0], c[1], c[2]) <= 70) nB++;   // 黒の縁（1pxで、背景と混ざって半透明になるので、暗い画素として数える）
        }
        // 周囲の背景：目印の外側（縁のさらに外 5〜9px）の画素の平均色
        let br = 0, bgc = 0, bgs = [0, 0, 0];
        for(let a = 0; a < 48; a++){ const ang = a / 48 * 2 * Math.PI, rr = (cfg.size / 2 + 3 + 7); const x = Math.round(e.x + Math.cos(ang) * rr), y = Math.round(e.y + Math.sin(ang) * rr);
          if(x < 0 || y < 0 || x >= Wc || y >= Hc) continue; const c = px(buf, Wc, x, y); bgs[0] += c[0]; bgs[1] += c[1]; bgs[2] += c[2]; bgc++; }
        const bgm = bgc ? bgs.map(v => v / bgc) : [0, 0, 0];
        const cen = nF ? [sx / nF, sy / nF] : [NaN, NaN];
        const dx = cen[0] - e.x, dy = cen[1] - e.y;
        const de = dE(fill, bgm);
        const visible = nF >= 100 && nW >= 40 && nB >= 20;
        const w = maxx - minx + 1, h = maxy - miny + 1;
        sizes[kind + z] = [w, h];
        rows.push({ cname, z, kind, nF, nW, nB, w, h, dpos: Math.hypot(dx, dy), de, visible });
        report(`| ${cname} | ×${z} | ${kind === 'chest' ? '宝箱▼' : '掲示板◆'} | ${nF} | ${nW} | ${nB} | ${w}×${h} | ${Math.hypot(dx, dy).toFixed(1)} | ${de.toFixed(0)} | ${ok(visible)} |`);
        // スクリーンショット（目印の周りを切り出し）
        const clip = { x: Math.max(0, Math.round(e.x - 70)), y: Math.max(0, Math.round(e.y - 45)), width: 140, height: 110 };
        const el = await page.$('#game'); const bb = await el.boundingBox();
        const f = `m_${cname.replace(/[（）・ ]/g, '')}_${z}_${kind}.png`;
        await page.screenshot({ path: path.join(OUT, f), clip: { x: bb.x + clip.x, y: bb.y + clip.y, width: Math.min(clip.width, Wc - clip.x), height: Math.min(clip.height, Hc - clip.y) } });
        shots.push({ cname, z, kind, f });
      }
    }
  }
  const nVis = rows.filter(r => r.visible).length;
  report(`\n- はっきり見える（塗り100画素以上・白の縁40画素以上・暗い縁20画素以上）：**${nVis}/${rows.length}**。中心の位置ずれの最大 ${Math.max(...rows.map(r => r.dpos)).toFixed(1)}px。`);
  // ズームで大きさが変わらない
  const sz = {}; ZOOMS.forEach(z => { sz[z] = [sizes['chest' + z], sizes['board' + z]]; });
  report(`- 大きさ（塗りの外接矩形 幅×高さ。宝箱▼／掲示板◆）：×1.0 ${sz[1].map(a => a.join('×')).join('／')}、×1.7 ${sz[1.7].map(a => a.join('×')).join('／')}、×3.5 ${sz[3.5].map(a => a.join('×')).join('／')} → ズームで変わらない = ${ok(ZOOMS.every(z => [0, 1].every(k => Math.abs(sz[z][k][0] - sz[1][k][0]) <= 1 && Math.abs(sz[z][k][1] - sz[1][k][1]) <= 1)))}`);
  // 色の区別
  const river = hex('#33CCFF'), rails = [['新幹線', hex('#ff3b30')], ['JR', hex('#0f7a3d')], ['私鉄', hex('#8e5bc9')]];
  report('- 色の区別（Lab色差 ΔE。20以上なら明確に別の色）：');
  report('  | | 河川 #33CCFF | 新幹線 #ff3b30 | JR #0f7a3d | 私鉄 #8e5bc9 | 宝箱の金 | 掲示板のマゼンタ |'); report('  |---|---|---|---|---|---|---|');
  for(const [n, c] of [['宝箱 #FFC400', GOLD], ['掲示板 #FF2D95', MAGENTA]]) report(`  | ${n} | ${dE(c, river).toFixed(0)} | ${dE(c, rails[0][1]).toFixed(0)} | ${dE(c, rails[1][1]).toFixed(0)} | ${dE(c, rails[2][1]).toFixed(0)} | ${dE(c, GOLD).toFixed(0)} | ${dE(c, MAGENTA).toFixed(0)} |`);
  report('  （さらに白い縁2px＋黒い縁1pxがあるので、似た色の背景の上でも輪郭で見える。形も▼と◆で違う）');

  // 一覧画像（背景×ズーム×種類）
  {
    const imgs = shots.map(s => ({ ...s, data: 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, s.f)).toString('base64') }));
    const names = [...new Set(shots.map(s => s.cname))];
    let html = '<body style="margin:0;background:#fff;font:12px sans-serif"><table style="border-collapse:collapse"><tr><td></td>' + ZOOMS.map(z => `<td colspan=2 style="text-align:center">ズーム ×${z}</td>`).join('') + '</tr>';
    for(const n of names){ html += `<tr><td style="padding:2px 6px">${n}</td>` + ZOOMS.map(z => ['chest', 'board'].map(k => { const s = imgs.find(i => i.cname === n && i.z === z && i.kind === k); return `<td style="padding:1px"><img src="${s.data}" style="display:block"></td>`; }).join('')).join('') + '</tr>'; }
    html += '</table></body>';
    const sp = await ctx.newPage(); await sp.setViewport?.({ width: 1000, height: 1000 }); await sp.setContent(html); await sp.screenshot({ path: path.join(OUT, 'markers_sheet.png'), fullPage: true }); await sp.close();
  }

  // ================= 2) 取得・読了後に消える／全宝箱で同じ目印／霧の下では見えない／カリング =================
  await page.evaluate(() => { window.__cnt = { chest: 0, board: 0 }; });
  // 1フレームで、目印のビットマップが貼られた（drawImage）回数
  const count = async () => page.evaluate(() => { window.__cnt.chest = 0; window.__cnt.board = 0; window.__pump(1); return { chest: window.__cnt.chest, board: window.__cnt.board }; });
  const T0 = targets.forest[0] || targets.urban[0];
  // 画面内に、宝箱4（time/speed/fifty/compass）と掲示板3を置く
  const scene = (items) => page.evaluate(([T, items, cfg]) => {
    const cam = T; resetFogTiles(); state.compassActive = false; state.timeLeft = 120; state.player.lat = cam[0]; state.player.lon = cam[1]; setCameraZoom(1.0);
    state.chests = items.chests.map(c => { const p = window.__off(T[0], T[1], c[0], c[1]); return { lat: p.lat, lon: p.lon, item: c[2], state: 'closed', openStart: 0 }; });
    state.hintBoards = items.boards.map((b, i) => { const p = window.__off(T[0], T[1], b[0], b[1]); return { lat: p.lat, lon: p.lon, questionId: currentKnowledge[i].id, state: 'active' }; });
    revealFogAt(worldX(T[1]), worldY(T[0])); window.__pump(30);
  }, [T0, items, cfg]);
  const items4 = { chests: [[-70, -40, 'time'], [60, -50, 'speed'], [-60, 60, 'fifty'], [80, 70, 'compass']], boards: [[0, -90], [-110, 10], [110, 0]] };
  await scene(items4);
  const c1 = await count();
  report('\n| 確認 | 結果 |'); report('|---|---|');
  report(`| 宝箱4個（中身が time／speed／fifty／compass）と掲示板3枚が画面内：描かれた目印の数（宝箱▼ / 掲示板◆） | ${ok(c1.chest === 4 && c1.board === 3)} ${c1.chest} / ${c1.board} |`);
  // 中身で目印が変わらない：中身を入れ替えても、画面が1画素も変わらない
  // 揺れは時間で動くので、同じ時刻で2回描いて比べる（中身だけを入れ替える）
  const vt0 = await page.evaluate(() => window.__getVT());
  await page.evaluate(v => { window.__setVT(v); window.__pump(1); }, vt0);
  const snapA = await region(page, 0, 0, Wc, Hc);
  await page.evaluate(v => { const its = ['compass', 'fifty', 'speed', 'time']; state.chests.forEach((c, i) => { c.item = its[i]; }); window.__setVT(v); window.__pump(1); }, vt0);
  const snapB = await region(page, 0, 0, Wc, Hc);
  await page.evaluate(() => { const its = ['time', 'speed', 'fifty', 'compass']; state.chests.forEach((c, i) => { c.item = its[i]; }); });
  const mcent = await page.evaluate(cfg => state.chests.map(c => { const pWX = worldX(state.player.lon), pWY = worldY(state.player.lat);
    return [W / 2 + (worldX(c.lon) - pWX), H / 2 + (worldY(c.lat) + cfg.foot - cfg.chestH - pWY) - cfg.gap - cfg.size / 2]; }), cfg);
  let dpx = 0, dAll = 0;
  for(let y = 0; y < Hc; y++) for(let x = 0; x < Wc; x++){
    const a = px(snapA, Wc, x, y), b = px(snapB, Wc, x, y); if(a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) continue;
    dAll++; if(mcent.some(m => Math.abs(x - m[0]) <= 16 && Math.abs(y - m[1]) <= 16)) dpx++;
  }
  report(`| 宝箱の中身を入れ替えても、目印は変わらない（同じ時刻で描き比べ。目印の周囲±16pxの差のある画素 / 画面全体の差） | ${ok(dpx === 0)} ${dpx} / ${dAll}（画面全体の差のうち、目印と無関係な画素：${dAll - dpx}） |`);
  // 取得で消える
  await page.evaluate(() => { const c = state.chests[0]; state.player.lat = c.lat; state.player.lon = c.lon; window.__pump(3); });
  const c2 = await count(); report(`| 宝箱1個を取得（開封中）：目印の数 | ${ok(c2.chest === 3 && c2.board === 3)} 宝箱 ${c2.chest}（取得前4）／掲示板 ${c2.board} |`);
  await page.evaluate(() => { window.__pump(120); }); const c2b = await count(); report(`| 開封が終わって消えた後：目印の数 | ${ok(c2b.chest === 3)} 宝箱 ${c2b.chest} |`);
  await page.evaluate(() => { const b = state.hintBoards[0]; state.player.lat = b.lat; state.player.lon = b.lon; window.__pump(3); });
  const c3 = await count(); report(`| 掲示板1枚を読了：目印の数 | ${ok(c3.board === 2 && c3.chest === 3)} 宝箱 ${c3.chest}／掲示板 ${c3.board}（読了前3） |`);
  // 霧の下では見えない：未探索の場所に置いた物体の目印は、画面に出ない。
  // ズーム1.0では、プレイヤーの探索半径（約266px）が画面全体より広く、未探索の物体を画面内に作れないので、検証の間だけ探索半径を小さくする（終わったら戻す）
  await page.evaluate(([T]) => {
    CONFIG.FOG_REVEAL_RADIUS_BASE_PX = 80; resetFogTiles(); state.compassActive = false; state.timeLeft = 120;
    const p = window.__off(T[0], T[1], 0, 0); state.player.lat = p.lat; state.player.lon = p.lon; setCameraZoom(1.0);
    const a = window.__off(T[0], T[1], 130, 40), b = window.__off(T[0], T[1], -120, -60);    // 探索半径の外で、画面の内側
    state.chests = [{ lat: a.lat, lon: a.lon, item: 'time', state: 'closed', openStart: 0 }];
    state.hintBoards = [{ lat: b.lat, lon: b.lon, questionId: currentKnowledge[0].id, state: 'active' }];
    window.__pump(20);
  }, [T0]);
  const cf = await count();
  const vtOn = await page.evaluate(() => window.__getVT());   // オンの画面の時刻。オフの画面も同じ時刻で描く（時間で動くものを除く）
  const withM = await region(page, 0, 0, Wc, Hc);
  await cpng(page, 'm_fog_1_markers_on.png');
  await page.evaluate(v => { CONFIG.SHOW_ITEM_MARKERS = false; window.__setVT(v - 1000 / 60); window.__pump(1); }, vtOn);
  const withoutM = await region(page, 0, 0, Wc, Hc);
  await cpng(page, 'm_fog_2_markers_off.png');   // 霧の下の物体だけが対象で、プレイヤー・地形は動かないので、時刻が1フレーム違っても同じはず
  await page.evaluate(() => { CONFIG.SHOW_ITEM_MARKERS = true; });
  // 比べるのは、プレイヤーの探索の円（この検証では半径 80×1.4≒112px）の縁より外側の画素。縁（霧のグラデーション）は、連続する2フレームの間にも
  // 少しずつ晴れていく既存の挙動で、目印とは無関係なので除く。目印を置いた位置（中心から約130px以上）は、すべて外側
  let dFog = 0, dMax = 0, dRim = 0;
  for(let y = 0; y < Hc; y++) for(let x = 0; x < Wc; x++){ const q = (y * Wc + x) * 4;
    const d = Math.max(Math.abs(withM[q] - withoutM[q]), Math.abs(withM[q + 1] - withoutM[q + 1]), Math.abs(withM[q + 2] - withoutM[q + 2]));
    const inMini = (x >= Wc - 92 - 18 && y <= 12 + 92 + 8);   // ミニマップ（これも霧が1フレームごとに少し晴れる）
    if(inMini) continue;
    if(Math.hypot(x - Wc / 2, y - Hc / 2) > 125){ if(d > 0) dFog++; if(d > dMax) dMax = d; } else if(d > 0) dRim++; }
  const exactMarker = (() => { let n = 0; for(let y = 0; y < Hc; y++) for(let x = 0; x < Wc; x++){ const c = px(withM, Wc, x, y); if(near(c, GOLD, 2) || near(c, MAGENTA, 2)) n++; } return n; })();
  // 霧は不透明度93%（rgba(4,8,14,0.93)）なので、霧の合成の前に描くだけでは、下にあるものが7%だけ透けて位置がうっすら分かる（初版で確認）。
  // そのため、霧が完全に晴れていない場所では目印を描かない：描画命令が0で、目印オン／オフで画面が1画素も変わらないこと
  report(`| 霧の下（未探索）に物体がある時：目印の描画命令の数（宝箱/掲示板）${cf.chest}/${cf.board}、目印の色の画素 ${exactMarker}、目印オン／オフで差のある画素（探索の円の縁より外側）${dFog}（最大差 ${dMax}/255）。縁の内側の ${dRim} 画素は、霧の縁が1フレームごとに少し晴れる既存の挙動 | ${ok(cf.chest === 0 && cf.board === 0 && exactMarker === 0 && dFog === 0)} |`);
  // 同じ物体を探索済みにすると見える（対照）
  await page.evaluate(() => { [state.chests[0], state.hintBoards[0]].forEach(o => { [0, -30, -64].forEach(dy => revealFogAt(worldX(o.lon), worldY(o.lat) + dy)); }); window.__pump(3); });
  await cpng(page, 'm_fog_3_explored.png');
  const withR = await region(page, 0, 0, Wc, Hc); let nR = 0; for(let y = 0; y < Hc; y++) for(let x = 0; x < Wc; x++){ const c = px(withR, Wc, x, y); if(near(c, GOLD, 2) || near(c, MAGENTA, 2)) nR++; }
  report(`| （対照）同じ物体の周りを探索済みにすると見える：目印の色の画素数 | ${ok(nR >= 200)} ${nR} |`);
  await page.evaluate(() => { CONFIG.FOG_REVEAL_RADIUS_BASE_PX = 190; });
  // カリング：画面外は描かない（画面＋余白40px の外）
  const cullTest = async (dxScreen, dyScreen) => page.evaluate(([T, dx, dy, cfg]) => {
    resetFogTiles(); state.compassActive = false; state.timeLeft = 120; const p = window.__off(T[0], T[1], 0, 0); state.player.lat = p.lat; state.player.lon = p.lon; setCameraZoom(1.0); revealFogAt(worldX(T[1]), worldY(T[0]));
    const o = window.__off(T[0], T[1], dx, dy + (cfg.chestH - cfg.foot));  // 上端が画面の (dx,dy) になる位置（足元を下げる）
    state.chests = [{ lat: o.lat, lon: o.lon, item: 'time', state: 'closed', openStart: 0 }]; state.hintBoards = [];
    [0, -30, -60].forEach(d => revealFogAt(worldX(o.lon), worldY(o.lat) + d));   // 探索済みにして、カリングだけで決まるようにする
    window.__cnt.chest = 0; window.__pump(1); return window.__cnt.chest; }, [T0, dxScreen, dyScreen, cfg]);
  const cIn = await cullTest(Wc / 2 - 20, 0), cEdge = await cullTest(Wc / 2 + 30, 0), cOut = await cullTest(Wc / 2 + 70, 0), cOutY = await cullTest(0, Hc / 2 + 120);
  report(`| 画面外のものは描かない（画面＋余白40px）：画面内（右端の20px手前）${cIn}、余白内（右端の30px外）${cEdge}、余白の外（右端の70px外）${cOut}、下の遠く ${cOutY}（描いた数） | ${ok(cIn === 1 && cEdge === 1 && cOut === 0 && cOutY === 0)} |`);
  // 探索済みの境界：プレイヤー（探索の中心）から目印の中心までの距離 d を変えて、描かれるか／見えるかを測る（ズーム1.0。霧の解除半径は約266px、完全に晴れるのはその75%≒200px）
  {
    const rowsS = [];
    for(const d of [60, 120, 160, 175, 185, 190, 200, 215, 230]){
      const r = await page.evaluate(([T, d, cfg]) => {
        resetFogTiles(); state.compassActive = false; state.timeLeft = 120; setCameraZoom(1.0);
        const p = window.__off(T[0], T[1], 0, 0); state.player.lat = p.lat; state.player.lon = p.lon;
        const o = window.__off(T[0], T[1], d, (cfg.chestH - cfg.foot) + (cfg.gap + cfg.size / 2));   // 目印の中心が、T の真東 d px
        state.chests = [{ lat: o.lat, lon: o.lon, item: 'time', state: 'closed', openStart: 0 }]; state.hintBoards = [];
        window.__pump(20); window.__setVT(Math.ceil(window.__getVT() / cfg.period) * cfg.period - 1000 / 60);
        window.__cnt.chest = 0; window.__pump(1);
        return { drawn: window.__cnt.chest, x: W / 2 + d, y: H / 2 - 0 };
      }, [T0, d, cfg]);
      let nF = 0;
      if(r.x < Wc - 16){ const b = await region(page, 0, 0, Wc, Hc); for(let y = 0; y < Hc; y++) for(let x = Math.max(0, Math.round(r.x - 20)); x <= Math.min(Wc - 1, Math.round(r.x + 20)); x++){ if(near(px(b, Wc, x, y), GOLD, 2)) nF++; } }
      rowsS.push([d, r.drawn, nF, r.x < Wc - 16]);
    }
    const partial = rowsS.filter(r => r[3] && r[1] === 1 && r[2] < 100).length;
    report(`| 探索済みの境界：目印の中心がプレイヤーから d px の所に物体を置いた時の「描いた数／金の画素数（画面内のみ）」：` + rowsS.map(r => `${r[0]}px→${r[1]}／${r[3] ? r[2] : '画面外'}`).join('、') + ` | ${ok(partial === 0 && rowsS[0][1] === 1 && rowsS[rowsS.length - 1][1] === 0 && rowsS.filter(r => r[1] === 1).every(r => r[0] <= 190))} 描かれた時は必ず全体が見える（薄く出る状態は ${partial} 件）、描かれる限界は約 ${Math.max(...rowsS.filter(r => r[1] === 1).map(r => r[0]))}px |`);
  }
  // CONFIG.SHOW_ITEM_MARKERS=false で出ない
  await scene(items4); await page.evaluate(() => { CONFIG.SHOW_ITEM_MARKERS = false; window.__cnt.chest = 0; window.__cnt.board = 0; window.__pump(2); });
  const cOff = await page.evaluate(() => ({ chest: window.__cnt.chest, board: window.__cnt.board })); await page.evaluate(() => { CONFIG.SHOW_ITEM_MARKERS = true; });
  report(`| CONFIG.SHOW_ITEM_MARKERS=false で目印が出ない：描いた数 | ${ok(cOff.chest === 0 && cOff.board === 0)} ${cOff.chest}/${cOff.board} |`);

  // ================= 3) 揺れの周期：60Hz と 120Hz（擬似） =================
  async function bobSeries(stepMs){
    await scene(items4);
    return page.evaluate(([stepMs, GOLDc]) => {
      window.__setVT(1200 * 1000);   // 60Hz・120Hz とも、同じ絶対時刻から始める（揺れの位相を揃える）
      const series = []; const t0 = window.__getVT();
      const c = document.getElementById('game').getContext('2d');
      const nF = Math.round(3600 / stepMs);
      for(let i = 0; i < nF; i++){
        state.timeLeft = 120; window.__pump(1, stepMs);
        // 先頭の宝箱の目印（金の塗り）の重心yを、左上の宝箱付近の窓で測る
        const pWX = worldX(state.player.lon), pWY = worldY(state.player.lat), o = state.chests[0];
        const sx = W / 2 + (worldX(o.lon) - pWX), top = H / 2 + (worldY(o.lat) + CHEST_SIZE_PX / 2 - CONFIG.CHEST_SIZE - pWY) - CONFIG.MARKER_GAP_PX - CONFIG.MARKER_SIZE_PX / 2;
        const x0 = Math.floor(sx - 14), y0 = Math.floor(top - 18);
        const d = c.getImageData(x0, y0, 28, 36).data; let sum = 0, n = 0;
        for(let y = 0; y < 36; y++) for(let x = 0; x < 28; x++){ const k = (y * 28 + x) * 4; if(Math.abs(d[k] - GOLDc[0]) <= 2 && Math.abs(d[k + 1] - GOLDc[1]) <= 2 && Math.abs(d[k + 2] - GOLDc[2]) <= 2){ sum += y0 + y + 0.5; n++; } }
        series.push([window.__getVT() - t0, n ? sum / n : NaN]);
      }
      return series;
    }, [stepMs, GOLD]);
  }
  const s60 = await bobSeries(1000 / 60), s120 = await bobSeries(1000 / 120);
  // 周期の推定：y(t) を、振幅の中心（平均）を上向きに横切る時刻の間隔
  const period = s => { const ys = s.map(a => a[1]), m = ys.reduce((a, b) => a + b, 0) / ys.length; const ts = []; for(let i = 1; i < s.length; i++) if(ys[i - 1] < m && ys[i] >= m){ const f = (m - ys[i - 1]) / (ys[i] - ys[i - 1]); ts.push(s[i - 1][0] + f * (s[i][0] - s[i - 1][0])); } const d = ts.slice(1).map((t, i) => t - ts[i]); return { n: ts.length, avg: d.reduce((a, b) => a + b, 0) / d.length, amp: (Math.max(...ys) - Math.min(...ys)) / 2 }; };
  const p60 = period(s60), p120 = period(s120);
  // 同じ時刻の位置の比較：t=100ms刻み（60Hz・120Hz どちらのフレームにも載る時刻）での y の差
  const at = (s, t) => { let best = null; s.forEach(a => { if(best === null || Math.abs(a[0] - t) < Math.abs(best[0] - t)) best = a; }); return best; };
  let maxd = 0; for(let t = 200; t <= 3400; t += 100){ const a = at(s60, t), b = at(s120, t); if(Math.abs(a[0] - b[0]) < 5) maxd = Math.max(maxd, Math.abs(a[1] - b[1])); }
  report(`| 揺れの周期：60Hz（16.7ms刻み）${p60.avg.toFixed(0)}ms／120Hz（8.3ms刻み）${p120.avg.toFixed(0)}ms（設定 ${cfg.period}ms）、振幅 ${p60.amp.toFixed(1)}px／${p120.amp.toFixed(1)}px（設定 ${cfg.bob}px）。同じ時刻での y の差の最大 ${maxd.toFixed(2)}px | ${ok(Math.abs(p60.avg - cfg.period) <= 40 && Math.abs(p120.avg - cfg.period) <= 40 && Math.abs(p60.avg - p120.avg) <= 20 && maxd <= 0.6)} |`);
  report(`| ページのエラー | ${ok(errors.length === 0)} ${errors.slice(0, 2).join(' | ')} |`);
  await ctx.close();
  report('');

  // ================= 4) フレーム時間：目印あり／なし（宝箱14＋掲示板20）、CPU 1倍・4倍 =================
  report('**フレーム時間**（宝箱14＋掲示板20が画面内、ズーム1.0。1フレーム＝update＋draw。目印あり／なしを同じページで交互に150フレーム×12回測定。CPUスロットリング 1倍・4倍）');
  report('| CPU | 目印 | 中央値(ms) | 平均(ms) | 95%点(ms) |'); report('|---|---|---|---|---|');
  {
    const FORCE_PERF = () => {
      window.__off = (lat, lon, dx, dy) => { const sx = worldX(lon + 1) - worldX(lon), sy = worldY(lat + 1) - worldY(lat); return { lat: lat + dy / sy, lon: lon + dx / sx }; };
      const T = [state.player.lat, state.player.lon]; state.chests = []; state.hintBoards = [];
      for(let i = 0; i < 14; i++){ const a = i / 14 * Math.PI * 2, r = 70 + (i % 3) * 40, p = window.__off(T[0], T[1], Math.cos(a) * r * 1.2, Math.sin(a) * r * 0.9); state.chests.push({ lat: p.lat, lon: p.lon, item: ['time', 'speed', 'fifty', 'compass'][i % 4], state: 'closed', openStart: 0 }); }
      for(let i = 0; i < 20; i++){ const a = (i + 0.5) / 20 * Math.PI * 2, r = 55 + (i % 4) * 32, p = window.__off(T[0], T[1], Math.cos(a) * r * 1.3, Math.sin(a) * r * 0.9); state.hintBoards.push({ lat: p.lat, lon: p.lon, questionId: currentKnowledge[i % currentKnowledge.length].id, state: 'active' }); }
      revealFogAt(worldX(T[1]), worldY(T[0]));
      state.chests.concat(state.hintBoards).forEach(o => { [0, -30, -60].forEach(d => revealFogAt(worldX(o.lon), worldY(o.lat) + d)); });   // すべての目印が描かれる（探索済み）状態で測る
    };
    const pf = await openPage(browser, 'new', '&diff=easy', { force: FORCE_PERF });
    for(let i = 0; i < 3000; i++){ await pf.page.evaluate(() => window.__pump(1)); if(await pf.page.evaluate(() => typeof gameStarted !== 'undefined' && gameStarted && !document.getElementById('loadingOverlay').classList.contains('show'))) break; await pf.page.waitForTimeout(10); }
    await pf.page.waitForTimeout(1500); await pf.page.evaluate(() => window.__pump(60));
    const info = await pf.page.evaluate(() => ({ c: state.chests.length, b: state.hintBoards.length }));
    const cdp = await pf.ctx.newCDPSession(pf.page);
    const stat = a => { const s = a.slice().sort((x, y) => x - y); return { med: s[Math.floor(s.length / 2)], mean: s.reduce((x, y) => x + y, 0) / s.length, p95: s[Math.floor(s.length * 0.95)] }; };
    const diffs = [];
    for(const rate of [1, 4]){
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      await pf.page.evaluate(() => window.__pump(60));
      const on = [], off = [];
      for(let blk = 0; blk < 12; blk++) for(const mode of [true, false]){
        const t = await pf.page.evaluate(m => { CONFIG.SHOW_ITEM_MARKERS = m; const a = []; for(let i = 0; i < 150; i++){ const t0 = window.__realNow(); window.__pump(1); a.push(window.__realNow() - t0); } return a; }, mode);
        (mode ? on : off).push(...t);
      }
      const A = stat(on), B = stat(off);
      report(`| ${rate}倍 | あり | ${A.med.toFixed(2)} | ${A.mean.toFixed(2)} | ${A.p95.toFixed(2)} |`); report(`| ${rate}倍 | なし | ${B.med.toFixed(2)} | ${B.mean.toFixed(2)} | ${B.p95.toFixed(2)} |`);
      // 目印の描画関数だけの直接の所要時間（34個を描く1回分。200回の中央値）
      const direct = await pf.page.evaluate(() => { CONFIG.SHOW_ITEM_MARKERS = true; const z = 1.0, toScreen = (wx, wy) => { const pWX = worldX(state.player.lon), pWY = worldY(state.player.lat); return [W / 2 + (wx - pWX), H / 2 + (wy - pWY)]; };
        const N = 2000; const t0 = window.__realNow(); for(let i = 0; i < N; i++){ ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2); drawItemMarkers(toScreen, z, 1000 + i * 16.7); ctx.restore(); }
        return (window.__realNow() - t0) / N; });   // 2000回の合計÷2000（タイマーの粗さの影響を避ける）
      report(`| ${rate}倍 | 目印の描画関数だけ（34個・1回の平均） | ${direct.toFixed(3)} | | |`);
      diffs.push([rate, A.med - B.med, A.mean - B.mean, (A.mean - B.mean) / B.mean, direct]);
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    report(`\n- 物体数：宝箱 ${info.c}＋掲示板 ${info.b}。目印あり−なしの差（平均）：` + diffs.map(d => `CPU${d[0]}倍 ${d[2].toFixed(2)}ms（${(d[3] * 100).toFixed(1)}%）`).join('、') + `。目印の描画関数だけを2000回呼んだ平均（参考）：` + diffs.map(d => `CPU${d[0]}倍 ${d[4].toFixed(2)}ms/フレーム`).join('、') + `。判定：フレーム全体の増加が平均で、60fpsの1フレーム(16.7ms)の5%（0.83ms）以内 = ${ok(diffs.every(d => Math.abs(d[2]) <= 0.83))}（1倍では 0.2ms 以内 = ${ok(Math.abs(diffs[0][2]) <= 0.2)}）`);
    await pf.ctx.close();
  }
  report('');
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
