// ======================================================================
// items.js
// 宝箱（アイテム専用）・ヒント掲示板・アイテム効果（スピードアップ等）
// ======================================================================

const IMG_CHEST_CLOSED = loadImg('assets/chest_closed.png', chromaKeyBlack);
const SHEET_CHEST_OPENING = loadSpriteSheet('assets/chest_opening_sheet.png', 9);
// 県の条件で、その種類が抽選に入るか：glider＝森林率+河川率 ≥ GLIDER_MIN_FOREST_RATIO、car＝陸地面積 ≥ CAR_MIN_AREA_KM2。他の種類は常に入る。
// stats＝県の地形の統計（省略時は今のラン＝読み込み中の県の prefLandStats）。統計がまだ無い時は、条件のある種類は入れない
function itemAvailable(key, stats){
  const st = stats || prefLandStats;
  if(key === 'glider') return !!st && st.forestRiverRatio >= CONFIG.GLIDER_MIN_FOREST_RATIO;
  if(key === 'car') return !!st && st.landAreaKm2 >= CONFIG.CAR_MIN_AREA_KM2;
  // 宝箱地図：未取得の宝箱が1つも無ければ抽選候補から外す（ラン中＝宝箱が配置済みの時だけ判定。配置前・?debug=loot のシミュレーションでは常に入る）
  if(key === 'map') return !(typeof state === 'object' && state && state.chests && state.chests.length > 0) || state.chests.some(c => c.state === 'closed');
  return true;
}
// 宝箱の中身の抽選（重み付き。CONFIG.CHEST_ITEM_WEIGHTS）。counts＝そのランで既に決めた数（種類ごと）。
// 県の条件を満たさない種類（itemAvailable）、上限（CONFIG.ITEM_MAX_PER_RUN）に達した種類、excludeKeys を候補から外し、残りの重みの合計で再正規化して抽選する（gameRandom）。
// 候補が空なら、保険として 'time' を返す。stats は ?debug=loot が他県で試す時に渡す（通常は省略）
function pickChestItem(counts, excludeKeys, stats, rnd){ // rnd：乱数関数（省略時は gameRandom。デイリーの中身の事前決定は生成用ストリームを渡す）
  if(CONFIG.DEBUG_FORCE_ITEM) return CONFIG.DEBUG_FORCE_ITEM;
  const caps = CONFIG.ITEM_MAX_PER_RUN || {}, cnt = counts || {};
  const pool = Object.keys(CONFIG.CHEST_ITEM_WEIGHTS).filter(k => {
    if(excludeKeys && excludeKeys.indexOf(k) >= 0) return false;
    if(!itemAvailable(k, stats)) return false;
    if(caps[k] !== undefined && (cnt[k] || 0) >= caps[k]) return false;
    return CONFIG.CHEST_ITEM_WEIGHTS[k] > 0;
  });
  if(pool.length === 0) return 'time';
  let total = 0;
  pool.forEach(k => { total += CONFIG.CHEST_ITEM_WEIGHTS[k]; });
  let r = (rnd ? rnd() : gameRandom()) * total;
  for(const k of pool){
    r -= CONFIG.CHEST_ITEM_WEIGHTS[k];
    if(r < 0) return k;
  }
  return pool[pool.length - 1];
}
// 宝箱を取った瞬間の効果（update() から呼ばれる）。time/speed/compass はその場で発動、fifty は所持品に入るだけ
// 🗺宝箱の地図：未取得の宝箱のうち、プレイヤーに最も近い1つを選び、その宝箱を必ず含む円（中心は宝箱からずらす＝宝箱が中心にならない）の霧を晴らす。
// 半径＝MAP_REVEAL_BASE_KM × scale（scale は時間・スピードと同じ式）。晴らした円は霧タイル（一度晴らした場所が残る方式）とミニマップのマスクに書き込まれ、そのまま残る。
// 取得中の宝箱（opening）は「未取得」に含めない。対象が無ければ false。
function activateTreasureMap(){
  const pWX = worldX(state.player.lon), pWY = worldY(state.player.lat);
  let best = null, bestD = Infinity;
  state.chests.forEach(c => {
    if(c.state !== 'closed') return;
    const d = distPx(pWX, pWY, worldX(c.lon), worldY(c.lat));
    if(d < bestD){ bestD = d; best = c; }
  });
  if(!best) return false;
  const pxPerKm = PX_PER_DEG_LAT / KM_PER_DEG_LAT;                       // ワールドpx / km
  const R = CONFIG.MAP_REVEAL_BASE_KM * state.itemScale * pxPerKm;       // 円の半径（ワールドpx）
  const range = CONFIG.MAP_OFFSET_RANGE;
  const off = (range[0] + gameRandom() * (range[1] - range[0])) * R;    // 宝箱から中心までのずれ（半径の25〜60%。円の内側に収まる）
  const ang = gameRandom() * Math.PI * 2;
  const cx = worldX(best.lon) + Math.cos(ang) * off, cy = worldY(best.lat) + Math.sin(ang) * off;
  revealFogDisc(cx, cy, R);                                              // main.js：霧タイル・ミニマップのマスク・探索済み記録に書き込む
  state.mapReveals.push({ x: cx, y: cy, r: R, chestLat: best.lat, chestLon: best.lon });
  return true;
}

function applyChestItem(item){
  if(item === 'speed'){
    activateSpeedBoost();
    showItemMessage('👟 スピードアップ発動！');
  } else if(item === 'car'){
    activateCar();
    showItemMessage('🚗 車に乗った！スピードアップより速い');
  } else if(item === 'glider'){
    activateGlider();
    showItemMessage('🪂 グライダー発動！森や川で遅くならない');
  } else if(item === 'map'){
    if(activateTreasureMap()) showItemMessage('🗺 宝箱の地図を手に入れた');
    else showItemMessage('🗺 宝箱の地図を手に入れた（取れる宝箱はもうありません）');
  } else if(item === 'fifty'){
    grantFiftyFifty();
    showItemMessage('✂️ 50-50 を入手！（ボス戦で使えます）');
  } else if(item === 'compass'){
    activateCompass();
    showItemMessage('🧭 県庁サーチ発動！ミニマップに県庁の位置が出ます');
  } else { // 'time'
    const sec = timeItemSecFor(state.itemScale); // 10秒×県の規模スケール（整数）
    state.timeLeft += sec;
    showItemMessage('⏱ 残り時間 +' + sec + '秒');
  }
}
// 速度系は1スロットのみ：スピードと車は、新しく取った方が上書きする（効果時間は延長ではなく置き換え）。倍率は main.js の update が speedKind で決める
function activateSpeedBoost(){
  // 効果時間のみ県の規模スケール倍（倍率 SPEED_BIKE_MULT は据え置き）。ui.js の残量バーが使うので、今回の効果時間も持つ
  state.speedKind = 'speed';
  state.speedBoostDurationMs = speedBoostSecFor(state.itemScale) * 1000;
  state.speedBoostUntil = performance.now() + state.speedBoostDurationMs;
}
function activateCar(){
  state.speedKind = 'car'; // 倍率 CAR_SPEED_MUL（スピードの上位版）。効果時間のみ scale 倍
  state.speedBoostDurationMs = carSecFor(state.itemScale) * 1000;
  state.speedBoostUntil = performance.now() + state.speedBoostDurationMs;
}
// グライダー：一定時間、森林・河川の減速を無効にする。速度系とは独立した効果で、同時に有効にできる（再取得は延長ではなく置き換え）
function activateGlider(){
  state.gliderDurationMs = gliderSecFor(state.itemScale) * 1000;
  state.gliderUntil = performance.now() + state.gliderDurationMs;
}
// 宝箱を取った時のアイテム入手メッセージ（宝箱はアイテム専用。ヒントは出さない）
let itemMsgTimer = null;
function showItemMessage(text){
  hintBanner.innerHTML = '<b>アイテム入手</b><br>' + text;
  hintBanner.classList.add('show');
  if(itemMsgTimer) clearPausableTimeout(itemMsgTimer);
  itemMsgTimer = pausableTimeout(()=> hintBanner.classList.remove('show'), 2200); // ポーズ中は進まない（main.js）
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
//  ・宝箱の中身では変えない（全部同じ▼）。霧の合成より前に描く。表示の条件は「位置が画面＋MARKER_MARGIN_PX に入った」だけ（距離判定は無い）。
//    CONFIG.MARKER_ONLY_EXPLORED=true なら、霧が完全に晴れた場所（isExploredAt）でだけ描く。画面外矢印・距離表示は無い
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
  const size = CONFIG.MARKER_SIZE_PX, gap = CONFIG.MARKER_GAP_PX, margin = CONFIG.MARKER_MARGIN_PX, onlyExplored = CONFIG.MARKER_ONLY_EXPLORED;
  const bob = CONFIG.MARKER_BOB_PX * Math.sin(2 * Math.PI * nowMs / CONFIG.MARKER_BOB_PERIOD_MS);
  const wOut = CONFIG.MARKER_OUTLINE_WHITE_PX, bOut = CONFIG.MARKER_OUTLINE_BLACK_PX;
  const paths = getMarkerPaths();
  function one(sx, topY, kind, wx, wyCenter){
    // 画面内（ビューポート＋MARKER_MARGIN_PX）に、目印の位置（ワールド座標を画面に写した点）が入ったら表示。単純な範囲判定だけ（対象は掲示板20個＋宝箱のみ）
    const px = W/2 + (sx - W/2) * z, tipY = H/2 + (topY - H/2) * z - gap;   // 目印の先端の画面位置（目印はそこから size だけ上）
    if(px < -margin || px > W + margin || tipY < -margin || tipY - size > H + margin) return;
    if(onlyExplored && !isExploredAt(wx, wyCenter)) return; // 任意：霧が完全に晴れていない場所では描かない
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

// ==== デバッグ：?debug=loot で、宝箱の中身の抽選を1000プレイ分シミュレーションし、県ごと（CONFIG.DEBUG_LOOT_PREFS＝北海道・東京）に種類別の平均取得数を console.table で出す（通常起動では何も出さない） ====
// 1プレイ＝NORMAL の宝箱数（computeChestCount。難易度の規模は県によらず spawnMaxKm で決まる）ぶんの宝箱を開ける。県の条件（グライダー・車）・上限・重みは本番と同じ pickChestItem（stats はその県の統計）
function printLootTable(){
  const diff = CONFIG.DIFFICULTY.NORMAL, PLAYS = 1000, types = Object.keys(CONFIG.CHEST_ITEM_WEIGHTS);
  return Promise.all(CONFIG.DEBUG_LOOT_PREFS.map(code => fetchPrefLandStats(code).catch(e => { console.warn('[loot] 県' + code + ' の地形統計を計算できません: ' + e); return null; }))).then(statsList => {
    const rows = [];
    CONFIG.DEBUG_LOOT_PREFS.forEach((code, pi) => {
      const st = statsList[pi]; if(!st) return;
      const sum = {}, min = {}, max = {}, capHit = {}; types.forEach(t => { sum[t] = 0; min[t] = Infinity; max[t] = 0; capHit[t] = 0; });
      let chestsTotal = 0;
      for(let p = 0; p < PLAYS; p++){
        const counts = {}, n = computeChestCount(diff); chestsTotal += n;
        for(let i = 0; i < n; i++){ const it = pickChestItem(counts, null, st); counts[it] = (counts[it] || 0) + 1; }
        types.forEach(t => { const c = counts[t] || 0; sum[t] += c; if(c < min[t]) min[t] = c; if(c > max[t]) max[t] = c;
          const cap = CONFIG.ITEM_MAX_PER_RUN[t]; if(cap !== undefined && c >= cap) capHit[t]++; });
      }
      types.forEach(t => rows.push({ '県コード': code, '種類': t, '抽選に入る': itemAvailable(t, st) ? '○' : '×（県の条件）', '重み': CONFIG.CHEST_ITEM_WEIGHTS[t],
        '上限': (CONFIG.ITEM_MAX_PER_RUN[t] === undefined ? 'なし' : CONFIG.ITEM_MAX_PER_RUN[t]), '平均取得数': Math.round(sum[t] / PLAYS * 100) / 100,
        '最小': (min[t] === Infinity ? 0 : min[t]), '最大': max[t], '上限到達率(%)': (CONFIG.ITEM_MAX_PER_RUN[t] === undefined ? '-' : Math.round(capHit[t] / PLAYS * 1000) / 10) }));
      rows.push({ '県コード': code, '種類': '（宝箱数の平均）', '抽選に入る': '', '重み': '', '上限': '', '平均取得数': Math.round(chestsTotal / PLAYS * 100) / 100, '最小': '', '最大': '', '上限到達率(%)': '' });
    });
    console.table(rows);
  });
}
// デバッグ表の呼び出し（terrain.js の expandLanduseGrid・computeLandStats が読み込まれた後のここで行う。通常起動では何も出さない）
(function(){
  const dbg = new URLSearchParams(window.location.search).get('debug');
  if(dbg === 'params') printParamsTable();
  else if(dbg === 'loot') printLootTable();
  else if(dbg === 'daily') printDailyTable();
})();
