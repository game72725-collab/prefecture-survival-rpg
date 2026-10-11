// ======================================================================
// items.js
// 宝箱（アイテム専用）・ヒント掲示板・アイテム効果（スピードアップ等）
// ======================================================================

const IMG_CHEST_CLOSED = loadImg('assets/chest_closed.png', chromaKeyBlack);
const SHEET_CHEST_OPENING = loadSpriteSheet('assets/chest_opening_sheet.png', 9);
// 宝箱の中身の抽選（CONFIG.CHEST_ITEM_WEIGHTS の重み）。excludeCompass=true なら🧭を候補から外す。
function pickChestItem(excludeCompass){
  if(CONFIG.DEBUG_FORCE_ITEM) return CONFIG.DEBUG_FORCE_ITEM;
  const pool = Object.keys(CONFIG.CHEST_ITEM_WEIGHTS).filter(k => !(excludeCompass && k === 'compass'));
  let total = 0;
  pool.forEach(k => { total += CONFIG.CHEST_ITEM_WEIGHTS[k]; });
  let r = gameRandom() * total;
  for(const k of pool){
    r -= CONFIG.CHEST_ITEM_WEIGHTS[k];
    if(r < 0) return k;
  }
  return pool[pool.length - 1];
}
// 宝箱を取った瞬間の効果（update() から呼ばれる）。time/speed/compass はその場で発動、fifty は所持品に入るだけ
function applyChestItem(item){
  if(item === 'speed'){
    activateSpeedBoost();
    showItemMessage('👟 スピードアップ発動！');
  } else if(item === 'fifty'){
    grantFiftyFifty();
    showItemMessage('✂️ 50-50 を入手！（ボス戦で使えます）');
  } else if(item === 'compass'){
    activateCompass();
    showItemMessage('🧭 県庁サーチ発動！ミニマップに県庁の位置が出ます');
  } else { // 'time'
    state.timeLeft += 10;
    showItemMessage('⏱ 残り時間 +10秒');
  }
}
function activateSpeedBoost(){
  state.speedBoostUntil = performance.now() + CONFIG.BIKE_DURATION_SEC * 1000;
}
// 宝箱を取った時のアイテム入手メッセージ（宝箱はアイテム専用。ヒントは出さない）
let itemMsgTimer = null;
function showItemMessage(text){
  hintBanner.innerHTML = '<b>アイテム入手</b><br>' + text;
  hintBanner.classList.add('show');
  if(itemMsgTimer) clearTimeout(itemMsgTimer);
  itemMsgTimer = setTimeout(()=> hintBanner.classList.remove('show'), 2200);
}

// ✂️50-50 の所持数を1つ増やす（取得してもその場では発動しない。使用はボス戦中の ui.js の useFiftyFifty）
function grantFiftyFifty(){ state.fiftyFiftyStock++; }

// 🧭県庁サーチ：そのラン中ずっと、ミニマップ上に県庁の印を出す（描画は ui.js の drawMinimap）。メイン画面の表示は変えない
function activateCompass(){ state.compassActive = true; }

// ==== ヒント掲示板 ====
// ヒント掲示板：ステージ開始時に、有効な問題から重複なしで（最大 CONFIG.HINT_BOARD_COUNT）問を選び、1問につき1つ置く。
// 配置（県全体／スポーンから届く範囲）は main.js の placeBoardsAndChests()。ここは取得判定と描画だけ。
// 触れたらその問題の hint を表示（パネルは ui.js の openHintPanel）し、掲示板は消える。
const IMG_HINT_BOARD = loadImg('assets/board.png'); // 素材が無い間は drawHintBoards() のフォールバック図形で表示
function checkHintBoardPickup(pWX, pWY){
  state.hintBoards.forEach(b=>{
    if(b.state !== 'active') return;
    if(distPx(pWX, pWY, worldX(b.lon), worldY(b.lat)) >= PICKUP_DIST_PX) return;
    const q = currentKnowledge.find(k => k.id === b.questionId);
    if(!q) return;
    b.state = 'gone';                   // 1回読んだら掲示板は消える
    state.readHintIds.add(q.id);        // ボス戦の出題で優先される
    openHintPanel(q.hint);              // ui.js：半透明パネル（タイマー・操作は止めない）
  });
}
function drawHintBoards(toScreen){
  state.hintBoards.forEach(b=>{
    if(b.state !== 'active') return;
    const [sx, sy] = toScreen(worldX(b.lon), worldY(b.lat));
    if(sx < -60 || sx > W+60 || sy < -60 || sy > H+60) return;
    drawSpriteOrFallback(IMG_HINT_BOARD, sx, sy + CHEST_SIZE_PX/2, CONFIG.HINT_BOARD_SIZE, ()=>{
      ctx.fillStyle = '#b07a3a';
      ctx.fillRect(sx - CHEST_SIZE_PX/2, sy - CHEST_SIZE_PX/2, CHEST_SIZE_PX, CHEST_SIZE_PX);
      ctx.strokeStyle = '#6b4a1e'; ctx.lineWidth = 3;
      ctx.strokeRect(sx - CHEST_SIZE_PX/2, sy - CHEST_SIZE_PX/2, CHEST_SIZE_PX, CHEST_SIZE_PX);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('ヒント', sx, sy + 4);
    });
  });
}

// ==== 宝箱・掲示板の目印 ====
// まだ取得していない宝箱（金色の▼）と、まだ読んでいない掲示板（マゼンタの◆）の上方に、上下に揺れる目印を出す。
//  ・大きさ・揺れ・縁取りは画面px固定：目印はカメラのズーム変換の内側で描くが、アンカー（スプライト上端）で 1/z に縮めて打ち消す
//  ・先端は、スプライトの上端の MARKER_GAP_PX 上。揺れは実時間（nowMs＝performance.now）の正弦波なので、フレーム数に依存しない
//  ・宝箱の中身では変えない（全部同じ▼）。霧の合成より前に描き、さらに「霧が完全に晴れた場所（isExploredAt）」でだけ描くので、
//    未探索の場所の目印は出ない（霧の透過7%でも位置が分からない）。画面外矢印・距離表示は無い
// 目印の形（先端が原点(0,0)・上向きが負）は、最初に1回だけ Path2D にしておき、毎フレームは使い回す。設定（大きさ）が変わったら作り直す
let markerPaths = null, markerPathKey = '';
function getMarkerPaths(){
  const size = CONFIG.MARKER_SIZE_PX;
  if(markerPaths && size === markerPathKey) return markerPaths;
  const tri = new Path2D(), dia = new Path2D(), h = size * 0.85, w = size * 0.8;
  tri.moveTo(0, 0); tri.lineTo(-size / 2, -h); tri.lineTo(size / 2, -h); tri.closePath();                    // ▼（宝箱）
  dia.moveTo(0, 0); dia.lineTo(-w / 2, -size / 2); dia.lineTo(0, -size); dia.lineTo(w / 2, -size / 2); dia.closePath(); // ◆（掲示板）
  markerPaths = { chest: tri, board: dia }; markerPathKey = size;
  return markerPaths;
}
function drawItemMarkers(toScreen, z, nowMs){
  if(!CONFIG.SHOW_ITEM_MARKERS) return;
  const size = CONFIG.MARKER_SIZE_PX, gap = CONFIG.MARKER_GAP_PX, cull = CONFIG.MARKER_CULL_MARGIN_PX;
  const bob = CONFIG.MARKER_BOB_PX * Math.sin(2 * Math.PI * nowMs / CONFIG.MARKER_BOB_PERIOD_MS);
  const wOut = CONFIG.MARKER_OUTLINE_WHITE_PX, bOut = CONFIG.MARKER_OUTLINE_BLACK_PX;
  const paths = getMarkerPaths();
  function one(sx, topY, kind, wx, wyCenter){
    if(!isExploredAt(wx, wyCenter)) return; // 霧が完全に晴れていない場所では描かない（霧の下で透けて、位置が分かってしまうため）
    // 画面上の位置（ズームを反映）で、画面＋余白の外はスキップ
    const px = W/2 + (sx - W/2) * z, py = H/2 + (topY - H/2) * z;
    if(px < -cull || px > W + cull || py - gap - size - 6 > H + cull || py - gap + 6 < -cull) return;
    const path = paths[kind];
    ctx.save();
    ctx.translate(sx, topY);              // アンカー＝スプライトの上端
    ctx.scale(1 / z, 1 / z);              // ここから先は画面px（ズームを打ち消す）
    ctx.translate(0, -gap + bob);         // 先端の位置：スプライト上端の gap(画面px) 上。上下に bob(画面px) だけ揺れる
    ctx.lineJoin = 'round';
    // 縁取り：黒（白の外側1px）→白（2px）→塗り。線は縁の中心に引かれるので、太さを2倍にして、内側半分を塗りで隠す
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2 * (wOut + bOut); ctx.stroke(path);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * wOut; ctx.stroke(path);
    ctx.fillStyle = (kind === 'chest') ? CONFIG.MARKER_CHEST_COLOR : CONFIG.MARKER_BOARD_COLOR;
    ctx.fill(path);
    ctx.restore();
  }
  const topOffset = CHEST_SIZE_PX / 2;   // スプライトは「足元中心」で sy+CHEST_SIZE_PX/2 に接地（main.js の宝箱・drawHintBoards と同じ）
  state.chests.forEach(c=>{
    if(c.state !== 'closed') return;     // 取得後（開封中・消えた後）は出さない
    const [sx, sy] = toScreen(worldX(c.lon), worldY(c.lat));
    one(sx, sy + topOffset - CONFIG.CHEST_SIZE, 'chest', worldX(c.lon), worldY(c.lat) + topOffset - CONFIG.CHEST_SIZE - (gap + size / 2) / z);
  });
  state.hintBoards.forEach(b=>{
    if(b.state !== 'active') return;     // 読了後は出さない
    const [sx, sy] = toScreen(worldX(b.lon), worldY(b.lat));
    one(sx, sy + topOffset - CONFIG.HINT_BOARD_SIZE, 'board', worldX(b.lon), worldY(b.lat) + topOffset - CONFIG.HINT_BOARD_SIZE - (gap + size / 2) / z);
  });
}

// ==== 更新 ====
