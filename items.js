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
  let r = Math.random() * total;
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
// ステージ開始時に、有効な問題から重複なしでN問をランダムに選び、1問につき1つ置く。
// 触れたらその問題の hint を表示（パネルは ui.js の openHintPanel）し、掲示板は消える。
const IMG_HINT_BOARD = loadImg('assets/board.png'); // 素材が無い間は drawHintBoards() のフォールバック図形で表示
function placeHintBoards(spawn){
  const n = Math.min(CONFIG.HINT_BOARD_COUNT, currentKnowledge.length);
  const picked = shuffleArray(currentKnowledge).slice(0, n); // 重複なし
  return picked.map(q=>{
    // スポーン地点から一定距離のランダムな地点（宝箱と同じ offsetLatLon）。海・海浜は避け、県境の内側だけにする
    let p = null;
    for(let tries = 0; tries < 40; tries++){
      const d = randRange(CONFIG.HINT_BOARD_DIST_MIN_KM, CONFIG.HINT_BOARD_DIST_MAX_KM);
      const a = randRange(0, Math.PI*2);
      p = offsetLatLon(spawn.lat, spawn.lon, d, a);
      if(isPassable(p.lat, p.lon) && isInsidePrefecture(p.lat, p.lon)) break;
    }
    return { lat: p.lat, lon: p.lon, questionId: q.id, state: 'active' };
  });
}
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

// ==== 更新 ====
