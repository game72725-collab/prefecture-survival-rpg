// ======================================================================
// verify_minimap.js — 固定の正方形ミニマップの検証（実ブラウザ Chromium + Playwright）
//   使い方：  node verify_minimap.js
//   前提    ：  ./old = 変更前、./new = 変更後（どちらも同じ data/。合成データは gen_synth.py で作る）
//   シナリオ：  東京(13・実データ)／縦長(45・合成)／北海道規模(01・合成。約5.6万×5万px)
//   出力    ：  verification_report_minimap.md（追記）と、out/*.png（ミニマップの画像）
// 乱数・時間・フレーム送りはページ内で固定する（製品コードは変更しない）
// ======================================================================
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const ROOT = __dirname, OUT = path.join(ROOT, 'out'), REPORT = path.join(ROOT, 'verification_report_minimap.md');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html':'text/html', '.js':'text/javascript', '.png':'image/png', '.webp':'image/webp', '.txt':'text/plain', '.csv':'text/csv' };
function serve(){
  return new Promise(res=>{
    const s = http.createServer((req,rsp)=>{
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if(!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()){ rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    }).listen(0, ()=>res(s));
  });
}
const report = line => { fs.appendFileSync(REPORT, line + '\n'); console.log(line); };

const INIT = `
(() => {
  let seed = 123456789;
  Math.random = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  let vt = 1000; performance.now = () => vt;
  window.__raf = []; window.requestAnimationFrame = f => { window.__raf.push(f); return window.__raf.length; };
  window.__pump = (n, ms) => { for(let i=0;i<n;i++){ const q = window.__raf; window.__raf = []; vt += (ms || 1000/60); q.forEach(f => f(vt)); } };
})();
`;
let BASE;
const SCN = [ { key:'tokyo', name:'東京(13・実データ)', pref:13 }, { key:'tall', name:'縦長(45・合成)', pref:45 }, { key:'huge', name:'北海道規模(01・合成)', pref:1 } ];

async function openGame(browser, dir, pref){
  const page = await browser.newPage({ viewport: { width: 390, height: 572 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if(m.type()==='error') errors.push(m.text()); });
  await page.addInitScript(INIT);
  await page.goto(`${BASE}/${dir}/index.html?pref=${pref}`);
  for(let i=0;i<3000;i++){
    await page.evaluate(()=>window.__pump(1));
    const done = await page.evaluate(()=> typeof gameStarted !== 'undefined' && gameStarted && !document.getElementById('loadingOverlay').classList.contains('show'));
    if(done) break;
    await page.waitForTimeout(10);
  }
  await page.waitForTimeout(1500); // 画像などの非同期の読み込みを終わらせてから操作する（実時間の読み込みとフレーム送りの位相のぶれを除く）
  await page.evaluate(()=>window.__pump(60));
  return { page, errors };
}
// canvas の矩形を生の画素（RGBA）で取り出す
const region = (page, x, y, w, h) => page.evaluate(([x,y,w,h])=>{
  const c = document.getElementById('game'); const d = c.getContext('2d').getImageData(x,y,w,h).data;
  let s=''; const CH=0x8000; for(let i=0;i<d.length;i+=CH) s += String.fromCharCode.apply(null, d.subarray(i,i+CH));
  return btoa(s);
}, [x,y,w,h]).then(b=>Buffer.from(b,'base64'));
const png = (page, x, y, w, h, k) => page.evaluate(([x,y,w,h,k])=>{
  const c = document.getElementById('game'); const t = document.createElement('canvas'); t.width = w*k; t.height = h*k;
  const g = t.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(c, x,y,w,h, 0,0,w*k,h*k); return t.toDataURL('image/png');
}, [x,y,w,h,k]);
const px = (buf, w, x, y) => { const i = (y*w + x)*4; return [buf[i],buf[i+1],buf[i+2],buf[i+3]]; };
const eq = (a,b,tol=0) => a.every((v,i)=>Math.abs(v-b[i])<=tol);
const MM = `({ W, H, x0: W - MINI_SIZE - 12, y0: 12, S: MINI_SIZE, scale: miniScale, offX: miniOffX, offY: miniOffY,
  rect: [miniRectX0, miniRectY0, miniRectX1, miniRectY1], WORLD_W, WORLD_H, wminX: worldMinX, wminY: worldMinY })`;

// 色が一致する画素の重心（画素の中心＝+0.5）
function centroid(buf, w, h, rgb, tol){
  let sx=0, sy=0, n=0;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){ const p = px(buf,w,x,y); if(eq(p.slice(0,3), rgb, tol)){ sx += x+0.5; sy += y+0.5; n++; } }
  return n ? { x: sx/n, y: sy/n, n } : null;
}

(async()=>{
  const server = await serve(); BASE = 'http://localhost:' + server.address().port;
  const browser = await chromium.launch();
  fs.writeFileSync(REPORT, '# verification_report_minimap.md — 固定の正方形ミニマップ\n\n実ブラウザ Chromium 141（Playwright）、画面 390×572。乱数・時間・フレーム送りはページ内で固定。old＝変更前、new＝変更後。\n\n');
  const shots = {}; const R = {};

  // ================= new：ミニマップの測定 =================
  for(const sc of SCN){
    const { page, errors } = await openGame(browser, 'new', sc.pref);
    const mm = await page.evaluate(MM + '');
    const S = mm.S, x0 = mm.x0, y0 = mm.y0;
    const out = { mm, errors };
    const crop = () => region(page, x0, y0, S, S);

    // (a) 初期状態（スポーン付近だけ探索済み）
    await page.evaluate(()=>window.__pump(2));
    const c0 = await crop();
    shots[sc.key+'_init'] = await png(page, x0-6, y0-6, S+12, S+12, 4);

    // (b) 余白と未探索の色：余白の全画素・矩形の四隅の未探索画素
    const [rx0,ry0,rx1,ry1] = mm.rect;
    const margin = new Set(); let marginN = 0;
    for(let y=0;y<S;y++) for(let x=0;x<S;x++) if(x<rx0||x>=rx1||y<ry0||y>=ry1){ margin.add(px(c0,S,x,y).join(',')); marginN++; }
    const corner = px(c0,S,rx0,ry0).join(','), corner2 = px(c0,S,rx1-1,ry1-1).join(',');
    // 矩形の縁（内側の1画素の枠）と、すぐ外側の余白の画素を比べる。違う画素は、縁まで陸が届いている所（霧の下の陸の色。従来から）
    const SEA = corner;           // 未探索の海（矩形の四隅は海）
    let edgeN = 0, edgeSeaSame = 0, edgeSea = 0, edgeLand = 0;
    const edgePair = (xi,yi,xo,yo)=>{ edgeN++; const a = px(c0,S,xi,yi).join(), b = px(c0,S,xo,yo).join(); if(a===SEA){ edgeSea++; if(a===b) edgeSeaSame++; } else edgeLand++; };
    for(let x=rx0;x<rx1;x++){ if(ry0>0) edgePair(x,ry0,x,ry0-1); if(ry1<S) edgePair(x,ry1-1,x,ry1); }
    for(let y=ry0;y<ry1;y++){ if(rx0>0) edgePair(rx0,y,rx0-1,y); if(rx1<S) edgePair(rx1-1,y,rx1,y); }
    const edgeSame = edgeSeaSame;
    // 計算上の「海の未探索」色：海 #123a52 に rgba(4,8,14,0.88) を重ねた色
    const exp = [0,1,2].map(i=>[4,8,14][i]*0.88 + [0x12,0x3a,0x52][i]*0.12);
    out.margin = { n: marginN, distinct: [...margin], corner, corner2, edgeSame, edgeN, edgeSea, edgeLand, expected: exp.map(v=>+v.toFixed(2)) };

    // (c) 探索の跡：県の外接矩形の中の離れた地点 P に、ゲームと同じ revealFogAt() で1回だけ霧を晴らし、前後の差を取る
    const P = await page.evaluate(()=>{
      const wx = worldMinX + 0.3*WORLD_W, wy = worldMinY + 0.35*WORLD_H;
      return { wx, wy, mx: miniX(wx), my: miniY(wy), rActual: CONFIG.FOG_REVEAL_RADIUS_BASE_PX*CONFIG.ZOOM_FACTOR*miniScale, rMin: CONFIG.MINIMAP_REVEAL_MIN_PX };
    });
    const before = await crop();
    await page.evaluate(([wx,wy])=>{ revealFogAt(wx,wy); window.__pump(1); }, [P.wx,P.wy]);
    const after = await crop();
    let maxR = 0, nDiff = 0, maxR50 = 0;
    for(let y=0;y<S;y++) for(let x=0;x<S;x++){
      const a = px(before,S,x,y), b = px(after,S,x,y); const d = Math.max(...[0,1,2].map(i=>Math.abs(a[i]-b[i])));
      const dist = Math.hypot(x+0.5-P.mx, y+0.5-P.my);
      if(d>=8){ nDiff++; if(dist>maxR) maxR = dist; }
      if(d>=40){ if(dist>maxR50) maxR50 = dist; }
    }
    out.trail = Object.assign(P, { visibleR: +maxR.toFixed(2), clearR: +maxR50.toFixed(2), nDiff });
    shots[sc.key+'_one'] = await png(page, x0-6, y0-6, S+12, S+12, 4);

    // (d) 長い経路（県の端から端まで）を歩いた跡。実際の経路は、ゲームと同じ revealFogAt() を、ワールド座標で等間隔に呼ぶ
    await page.evaluate(()=>{
      const ax = worldMinX + 0.12*WORLD_W, ay = worldMinY + 0.15*WORLD_H, bx = worldMinX + 0.88*WORLD_W, by = worldMinY + 0.82*WORLD_H;
      const n = Math.ceil(Math.hypot(bx-ax, by-ay) / 300);
      for(let i=0;i<=n;i++) revealFogAt(ax+(bx-ax)*i/n, ay+(by-ay)*i/n);
      window.__pump(2);
    });
    const c1 = await crop();
    shots[sc.key+'_trail'] = await png(page, x0-6, y0-6, S+12, S+12, 4);
    // 余白が汚れていないこと（探索後も余白は1色のまま）
    const margin2 = new Set(); for(let y=0;y<S;y++) for(let x=0;x<S;x++) if(x<rx0||x>=rx1||y<ry0||y>=ry1) margin2.add(px(c1,S,x,y).join(','));
    out.marginAfter = [...margin2];

    // (d2) 歩いた跡の幅：ゲームの1フレームの移動量（約5ワールドpx）ごとに revealFogAt() を呼んだ直線の、中央での幅（色差8以上の画素の縦の範囲）
    {
      const L = await page.evaluate(()=>{ const wy = worldMinY + 0.62*WORLD_H, ax = worldMinX + 0.2*WORLD_W, bx = worldMinX + 0.8*WORLD_W;
        const before = null; return { wy, ax, bx, my: miniY(wy), mxm: miniX((ax+bx)/2) }; });
      const b4 = await crop();
      await page.evaluate(([wy,ax,bx])=>{ const n = Math.ceil((bx-ax)/5); for(let i=0;i<=n;i++) revealFogAt(ax+(bx-ax)*i/n, wy); window.__pump(2); }, [L.wy,L.ax,L.bx]);
      const a4 = await crop(); const xc = Math.round(L.mxm);
      let ymin=1e9, ymax=-1; for(let y=0;y<S;y++){ const a = px(b4,S,xc,y), b = px(a4,S,xc,y); if(Math.max(...[0,1,2].map(i=>Math.abs(a[i]-b[i])))>=8){ ymin=Math.min(ymin,y); ymax=Math.max(ymax,y); } }
      out.walk = { widthPx: ymax>=ymin ? ymax-ymin+1 : 0, centerY: +L.my.toFixed(2) };
    }

    // (e) 外接矩形の四隅・辺の中点を探索した直後も、余白は未探索と同じ1色のまま
    await page.evaluate(()=>{
      [[0,0],[1,0],[0,1],[1,1],[0.5,0],[0.5,1],[0,0.5],[1,0.5]].forEach(([u,v])=>revealFogAt(worldMinX+u*WORLD_W, worldMinY+v*WORLD_H));
      window.__pump(2);
    });
    const c2 = await crop();
    const margin3 = new Set(); for(let y=0;y<S;y++) for(let x=0;x<S;x++) if(x<rx0||x>=rx1||y<ry0||y>=ry1) margin3.add(px(c2,S,x,y).join(','));
    out.marginAfterEdges = [...margin3];
    shots[sc.key+'_edges'] = await png(page, x0-6, y0-6, S+12, S+12, 4);

    // (f) 印の位置：プレイヤー（黄）・県庁（ピンクの星）。位置は、ゲームと同じ drawMinimap(pWX,pWY) に外接矩形の四隅・中心を渡して確認
    await page.evaluate(()=>{ activateCompass(); window.__pump(2); });
    const bossW = await page.evaluate(()=>({ wx: worldX(state.boss.lon), wy: worldY(state.boss.lat) }));
    const marks = [];
    for(const [name,u,v] of [['左上寄り',0.06,0.06],['右上寄り',0.94,0.06],['左下寄り',0.06,0.94],['右下寄り',0.94,0.94],['上',0.5,0.25],['左下',0.3,0.7]]){
      const wx = mm.wminX + u*mm.WORLD_W, wy = mm.wminY + v*mm.WORLD_H;
      await page.evaluate(([wx,wy])=>{ window.__pump(1); drawMinimap(wx,wy); }, [wx,wy]);
      const cc = await crop();
      const yel = centroid(cc,S,S,[255,217,61],3);
      const exX = mm.offX + (wx-mm.wminX)*mm.scale, exY = mm.offY + (wy-mm.wminY)*mm.scale;
      const pink = centroid(cc,S,S,[255,45,149],3);
      const bx = mm.offX + (bossW.wx-mm.wminX)*mm.scale, by = mm.offY + (bossW.wy-mm.wminY)*mm.scale;
      marks.push({ name, player: yel && { dx:+(yel.x-exX).toFixed(2), dy:+(yel.y-exY).toFixed(2) }, star: pink && { dx:+(pink.x-bx).toFixed(2), dy:+(pink.y-by).toFixed(2) }, ex:[+exX.toFixed(1),+exY.toFixed(1)], bossAt:[+bx.toFixed(1),+by.toFixed(1)] });
    }
    out.marks = marks;
    shots[sc.key+'_marks'] = await png(page, x0-6, y0-6, S+12, S+12, 4);

    // (g) 枠の形（正方形）：枠線 #8fa6bd の画素の外接矩形
    const fr = await region(page, x0-12, 0, S+24, S+30);
    let fx0=1e9,fy0=1e9,fx1=-1,fy1=-1; const fw = S+24, fh = S+30;
    for(let y=0;y<fh;y++) for(let x=0;x<fw;x++) if(eq(px(fr,fw,x,y).slice(0,3),[143,166,189],2)){ fx0=Math.min(fx0,x); fy0=Math.min(fy0,y); fx1=Math.max(fx1,x); fy1=Math.max(fy1,y); }
    out.frame = { w: fx1-fx0+1, h: fy1-fy0+1 };
    // 参考：未探索の陸と海の見た目の差（従来から。霧の下で県の形がうっすら見える）
    out.fogLandVsSea = [0,1,2].map(i=>+( (4*0.88+0x3f*0.12, [4,8,14][i]*0.88+[0x3f,0x6b,0x45][i]*0.12) - exp[i]).toFixed(1));

    R[sc.key] = out;
    await page.close();
  }

  // ---- レポート：ミニマップの形・余白 ----
  report('## 検証A：固定の正方形・余白と未探索が同じ見た目');
  report('| シナリオ | ワールド(px) | ミニマップ | 縮尺 | 県の矩形(画素) | 枠(幅×高) | 余白の画素数 | 余白の色の種類 | 余白＝未探索の海の色 |');
  report('|---|---|---|---|---|---|---|---|---|');
  for(const sc of SCN){
    const o = R[sc.key], m = o.mm;
    const same = o.margin.distinct.length===1 && o.margin.distinct[0]===o.margin.corner && o.margin.corner===o.margin.corner2;
    report(`| ${sc.name} | ${Math.round(m.WORLD_W)}×${Math.round(m.WORLD_H)} | ${m.S}×${m.S} | ${m.scale.toFixed(5)} | ${m.rect[2]-m.rect[0]}×${m.rect[3]-m.rect[1]} | ${o.frame.w}×${o.frame.h} | ${o.margin.n} | ${o.margin.distinct.length} (${o.margin.distinct.join(' / ') || '-'}) | ${o.margin.n===0 ? '（余白なし）' : (same ? '**一致**' : '不一致')}（計算値 ${o.margin.expected.join(',')}） |`);
  }
  report('');
  for(const sc of SCN){
    const o = R[sc.key];
    report(`- ${sc.name}：外接矩形の縁（内側1画素の枠 ${o.margin.edgeN}画素）のうち、海の未探索の画素 ${o.margin.edgeSea}個は、すぐ外側の余白と**${o.margin.edgeSame}/${o.margin.edgeSea}個が同色**。残り ${o.margin.edgeLand}個は縁まで陸が届いている所（霧の下の陸の色で、従来から海と僅かに違う）。広く歩いた後の余白の色の種類 ${o.marginAfter.length}、四隅・辺の中点を探索した直後の余白の色の種類 ${o.marginAfterEdges.length}（探索の書き込みは余白に及ばない）。`);
  }
  report('');
  report('## 検証B：探索の跡（ミニマップ上の描画半径 = max(実際の縮尺の半径, 3px)）');
  report('| シナリオ | 実際の縮尺の半径(px) | 描画半径(px) | 1回だけ探索：跡が見える半径(px)（色差8以上） | 同：はっきり見える半径(px)（色差40以上） | 歩いた跡（直線）の幅(px) |');
  report('|---|---|---|---|---|---|');
  for(const sc of SCN){ const t = R[sc.key].trail; report(`| ${sc.name} | ${t.rActual.toFixed(2)} | ${Math.max(t.rActual,t.rMin).toFixed(2)} | **${t.visibleR}** | ${t.clearR} | **${R[sc.key].walk.widthPx}** |`); }
  report('');
  report('## 検証C：印の位置（プレイヤー・県庁サーチの星）— 期待位置との差(px)');
  report('期待位置は、検証側で計算（縮尺＝一辺÷max(ワールド幅,高さ)、中央寄せ）。測定は、黄／ピンクの画素の重心。プレイヤーの位置は、外接矩形の四隅の内側（端から6%）・上・左下に置いて確認（矩形の角そのものに置くと、円がミニマップの縁でクリップされ重心がずれるため）。');
  report('| シナリオ | ' + R.tokyo.marks.map(m=>m.name).join(' | ') + ' |'); report('|---|' + R.tokyo.marks.map(()=>'---').join('|') + '|');
  for(const sc of SCN){ report(`| ${sc.name} プレイヤー | ` + R[sc.key].marks.map(m=>m.player?`(${m.player.dx}, ${m.player.dy})`:'見えない').join(' | ') + ' |'); }
  for(const sc of SCN){ report(`| ${sc.name} 県庁の星 | ` + R[sc.key].marks.map(m=>m.star?`(${m.star.dx}, ${m.star.dy})`:'見えない').join(' | ') + ' |'); }
  report(`- 参考（従来から変わらない点）：霧の下では、未探索の陸と海に RGB で最大 ${Math.max(...R.tokyo.fogLandVsSea.map(Math.abs))} 程度の差があり、県の形がうっすら見える。この点は今回変更していない。`);
  report(`- ページのエラー：東京 ${R.tokyo.errors.length}件、縦長 ${R.tall.errors.length}件、北海道規模 ${R.huge.errors.length}件 ${[...R.tokyo.errors,...R.tall.errors,...R.huge.errors].slice(0,2).join(' | ')}\n`);

  // ================= 画像（3シナリオを並べる） =================
  {
    const keys = ['init','one','trail','edges','marks']; const lab = { init:'開始直後', one:'1か所だけ探索', trail:'端から端まで歩いた跡', edges:'四隅・辺の中点も探索', marks:'印（右下に配置・県庁サーチ）' };
    const html = `<body style="margin:0;background:#fff;font:14px sans-serif"><div style="display:grid;grid-template-columns:140px repeat(${keys.length},auto);gap:6px;padding:8px;align-items:center">` +
      '<div></div>' + keys.map(k=>`<div style="text-align:center">${lab[k]}</div>`).join('') +
      SCN.map(sc=>`<div>${sc.name}</div>` + keys.map(k=>`<img src="${shots[sc.key+'_'+k]}" style="background:#888;display:block">`).join('')).join('') + '</div></body>';
    const pg = await browser.newPage({ viewport: { width: 1500, height: 1500 } }); await pg.setContent(html);
    await pg.screenshot({ path: path.join(OUT, 'minimap_new_all.png'), fullPage: true }); await pg.close();
    for(const sc of SCN) for(const k of keys) fs.writeFileSync(path.join(OUT, `minimap_${sc.key}_${k}.png`), Buffer.from(shots[sc.key+'_'+k].split(',')[1], 'base64'));
  }

  // ================= 回帰：同じ操作で、変更前と変更後を比べる（ミニマップの矩形を除く） =================
  report('## 検証D：既存機能が変更前と同じ結果（県庁サーチ・霧・dt・タイル）');
  report('操作：30フレーム→右へ90フレーム→上へ60フレーム（フレーム時間を 8ms／33ms／16.7ms／50ms で交互に変える＝dtの確認）→🧭県庁サーチ発動→20フレーム。新旧とも同じ操作・同じ乱数。');
  report('| シナリオ | キャンバス(ミニマップ矩形を除く)の差のある画素 | 状態(state) | 霧タイル | 地形タイル | 対照（旧を2回） | 備考 |');
  report('|---|---|---|---|---|---|---|');
  const script = async (page) => page.evaluate(()=>{
    const base = performance.now(); // 起動時の位相（実時間の読み込みで1フレーム前後する）を除くため、時刻は操作開始からの相対値で比べる
    window.__pump(30);
    const dts = [8, 33, 1000/60, 50];
    keys.right = true; for(let i=0;i<90;i++) window.__pump(1, dts[i%4]); keys.right = false;
    keys.up = true;    for(let i=0;i<60;i++) window.__pump(1, dts[i%4]); keys.up = false;
    activateCompass(); window.__pump(20);
    const scrub = o => JSON.parse(JSON.stringify(o, (k,v)=> (typeof v==='number' && (/ms$/i.test(k) || k==='frame')) ? undefined :  // 時間(ms)と、起動からの通算フレーム番号（起動直後の位相で前後する）は比べない
       (typeof v==='number' && /(Start|At)$/.test(k)) ? ((v-base) < 0 ? undefined : +(v-base).toFixed(3)) : v));
    return { state: scrub(state), fog: scrub(fogTileInfo()), terrain: scrub(terrainTileInfo()), p: [state.player.lon, state.player.lat] };
  });
  const snap = async (dir, pref) => { const g = await openGame(browser, dir, pref); const r = await script(g.page);
    const Wd = await g.page.evaluate(()=>W), Hd = await g.page.evaluate(()=>H);
    r.buf = await region(g.page, 0, 0, Wd, Hd); r.W = Wd; r.H = Hd;
    r.miniH = await g.page.evaluate(()=> typeof MINI_H==='number' ? MINI_H : 0); await g.page.close(); return r; };
  const j = x=>JSON.stringify(x);
  const cmpRuns = (a, b, exH) => { let diff = 0, inMini = 0; const Wd = a.W, exX = Wd - 92 - 12 - 6;
    for(let y=0;y<a.H;y++) for(let x=0;x<Wd;x++){ const i = (y*Wd+x)*4;
      if(a.buf[i]!==b.buf[i]||a.buf[i+1]!==b.buf[i+1]||a.buf[i+2]!==b.buf[i+2]||a.buf[i+3]!==b.buf[i+3]){ if(x>=exX && y<=exH) inMini++; else diff++; } }
    return { diff, inMini, state: j(a.state)===j(b.state), fog: j(a.fog)===j(b.fog), terrain: j(a.terrain)===j(b.terrain) }; };
  for(const sc of SCN){
    const o1 = await snap('old', sc.pref), o2 = await snap('old', sc.pref), n1 = await snap('new', sc.pref);
    const exH = Math.max(12 + 92 + 6, 12 + o1.miniH + 6); // 新旧どちらのミニマップの矩形も除く（旧は県の縦横比で高さが変わった）
    const ctl = cmpRuns(o1, o2, exH), r = cmpRuns(o1, n1, exH);
    const ok = v => v ? '一致' : '**不一致**';
    report(`| ${sc.name} | **${r.diff}** | ${ok(r.state)} | ${ok(r.fog)} | ${ok(r.terrain)} | 旧同士：画素差${ctl.diff}／状態${ok(ctl.state)}／霧${ok(ctl.fog)}／地形${ok(ctl.terrain)} | ミニマップ矩形内の差 ${r.inMini}画素（旧の高さ ${o1.miniH}px→新 92px）、全${n1.W*n1.H}画素 |`);
  }
  report('');
  await browser.close(); server.close();
})().catch(e=>{ console.error(e); process.exit(1); });
