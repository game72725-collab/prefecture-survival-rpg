// ======================================================================
// player.js
// プレイヤーの移動入力（D-pad・矢印キー）・アニメーション切り替え・スプライトシート読み込み
// ======================================================================

function loadSpriteSheet(src, frameCount){
  const img = new Image();
  img.ready = false;
  img.frameCount = frameCount;
  img.onload = ()=>{
    img.frameW = img.naturalWidth / frameCount;
    img.frameH = img.naturalHeight;
    img.ready = true;
  };
  img.onerror = ()=>{ img.ready = false; };
  img.src = src;
  return img;
}
const SHEET_PLAYER_WALK = loadSpriteSheet('assets/player_walk_sheet.png', 12); // 森林：山歩行として流用
const SHEET_PLAYER_RUN = loadSpriteSheet('assets/player_run_sheet.png', 14);    // 通常地形：ランニング
const SHEET_PLAYER_KAYAK = loadSpriteSheet('assets/player_kayak_sheet.png', 12); // 河川・湖沼：カヤック
// 自転車：assets/player_bike_sheet.png を置けば自動で使われる。素材が無い／読み込み失敗の間は、
// 選択側（update内）でランニング素材に自動フォールバックする。※コマ数は素材完成時に合わせて更新（現在は仮の12）
const SHEET_PLAYER_BIKE = loadSpriteSheet('assets/player_bike_sheet.png', 12);

// 現在のスプライトシート再生位置（フレームインデックスと経過時間）。地形が切り替わったらリセットする。
let playerAnimFrame = 0, playerAnimAccum = 0, playerAnimSheet = SHEET_PLAYER_RUN;
// ==== CONFIG：移動速度・アニメーション・ズーム・表示サイズの調整値をここにまとめる ====
SHEET_PLAYER_WALK.adjust = CONFIG.SHEET_ADJUST.walk;
SHEET_PLAYER_RUN.adjust = CONFIG.SHEET_ADJUST.run;
SHEET_PLAYER_KAYAK.adjust = CONFIG.SHEET_ADJUST.kayak;
SHEET_PLAYER_BIKE.adjust = CONFIG.SHEET_ADJUST.bike;
// カメラズーム（描画スケールのみ。ワールド座標・メッシュ・当たり判定・移動速度には一切関与しない）
const keys = { up:false, down:false, left:false, right:false };
function bindBtn(id, key){
  const el = document.getElementById(id);
  const on = (e)=>{ e.preventDefault(); keys[key]=true; el.classList.add('active'); };
  const off = (e)=>{ e.preventDefault(); keys[key]=false; el.classList.remove('active'); };
  el.addEventListener('touchstart', on, {passive:false});
  el.addEventListener('touchend', off, {passive:false});
  el.addEventListener('touchcancel', off, {passive:false});
  el.addEventListener('mousedown', on);
  el.addEventListener('mouseup', off);
  el.addEventListener('mouseleave', off);
}
// ==== ピンチズーム：canvas上の2本指操作だけを見る（D-padは別要素なので競合しない。移動処理には触れない） ====
bindBtn('up','up'); bindBtn('down','down'); bindBtn('left','left'); bindBtn('right','right');
window.addEventListener('keydown', (e)=>{
  if(e.key==='ArrowUp') keys.up=true; if(e.key==='ArrowDown') keys.down=true;
  if(e.key==='ArrowLeft') keys.left=true; if(e.key==='ArrowRight') keys.right=true;
});
window.addEventListener('keyup', (e)=>{
  if(e.key==='ArrowUp') keys.up=false; if(e.key==='ArrowDown') keys.down=false;
  if(e.key==='ArrowLeft') keys.left=false; if(e.key==='ArrowRight') keys.right=false;
});

// スピードアップ発動。発動中に再度呼ばれたら、残り時間を初期値(BIKE_DURATION_SEC)に戻す（加算しない）
function drawSpriteOrFallback(img, sx, sy, targetH, fallback){
  if(img && img.ready){
    const [nw, nh] = srcSize(img.renderSource);
    const w = targetH * (nw / nh);
    ctx.drawImage(img.renderSource, sx - w/2, sy - targetH, w, targetH); // 足元中心で接地
  } else {
    fallback();
  }
}
// スプライトシートから指定フレームだけを切り出して描画（本物のアルファ入りPNG、アニメ対応）
function drawSheetFrameOrFallback(sheet, frameIdx, sx, sy, targetH, fallback){
  if(sheet && sheet.ready){
    const idx = Math.max(0, Math.min(sheet.frameCount - 1, frameIdx));
    const w = targetH * (sheet.frameW / sheet.frameH);
    ctx.drawImage(sheet, idx * sheet.frameW, 0, sheet.frameW, sheet.frameH,
                  sx - w/2, sy - targetH, w, targetH); // 足元中心で接地
  } else {
    fallback();
  }
}

// ==== 描画 ====
