// ======================================================================
// items.js
// 宝箱・ヒント・アイテム効果（スピードアップ等）
// ======================================================================

const IMG_CHEST_CLOSED = loadImg('chest_closed.png', chromaKeyBlack);
const SHEET_CHEST_OPENING = loadSpriteSheet('chest_opening_sheet.png', 9);
function pickChestItem(){
  if(CONFIG.DEBUG_FORCE_ITEM === 'speed') return 'speed';
  return Math.random() < CONFIG.SPEED_CHEST_RATE ? 'speed' : 'time';
}
function activateSpeedBoost(){
  state.speedBoostUntil = performance.now() + CONFIG.BIKE_DURATION_SEC * 1000;
}
// 発動中表示（アイコン＋残り時間バー）の更新
let hintTimer = null;
function showHint(text){
  hintBanner.innerHTML = '<b>ヒント入手</b><br>' + text;
  hintBanner.classList.add('show');
  if(hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(()=> hintBanner.classList.remove('show'), 2200);
}

// ==== 更新 ====
