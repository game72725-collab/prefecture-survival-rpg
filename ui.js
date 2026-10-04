// ======================================================================
// ui.js
// HUD・タイマー表示・ミニマップ・クイズ画面
// ======================================================================

const dummyQuizzes = [
  { q: "この県の名物として知られる特産品は？（ダミー問題）", options: ["みかん", "カツオ", "りんご", "ラー油"], correctIndex: 1 },
  { q: "この県の県庁所在地はどれ？（ダミー問題）", options: ["仮の市A", "仮の市B", "仮の市C", "仮の市D"], correctIndex: 2 }
];
const NEAR_HINTS = ["小さいヒント：この地域の人口は約1,400万人（ダミー）", "小さいヒント：海に面したエリアがある（ダミー）"];
const FAR_HINTS = ["大きいヒント：特産品はキャベツと言われている（ダミー）", "大きいヒント：都道府県庁所在地の名前に「京」の字が入る（ダミー）"];

// レイヤー表示切り替え（地形テクスチャ／鉄道／河川）。見た目のon/offだけで、当たり判定・速度には一切関与しない。
// draw()（main.js）がこれらの.checkedを毎フレーム直接参照する。初期状態はHTML側でchecked（すべてオン）。
const toggleTexture = document.getElementById('toggleTexture');
const toggleRail = document.getElementById('toggleRail');
const toggleRiver = document.getElementById('toggleRiver');

function hideAllOverlays(){
  quizOverlay.classList.remove('show');
  gameOverOverlay.classList.remove('show');
  clearOverlay.classList.remove('show');
  wrongToast.style.display = 'none';
  hintBanner.classList.remove('show');
}

// ==== 入力 ====
function updateBoostHud(now){
  const remainMs = state.speedBoostUntil - now;
  if(remainMs > 0){
    boostHud.classList.add('show');
    boostBar.style.width = Math.min(100, remainMs / (CONFIG.BIKE_DURATION_SEC*1000) * 100) + '%';
    boostSec.textContent = Math.ceil(remainMs/1000) + 's';
  } else {
    boostHud.classList.remove('show');
  }
}

// ミニマップの高さ・霧合成用canvasはワールドの縦横比（県データ読み込み後に確定）で決まるため、
// 宣言だけここに置き、initMinimap()（main.jsのstartGame()から1回だけ呼ばれる）で作る。
const MINI_W = 92;
let MINI_H = 0, miniFogCanvas = null, miniFogCtx = null;
function initMinimap(){
  MINI_H = Math.round(MINI_W * (WORLD_H / WORLD_W));
  miniFogCanvas = document.createElement('canvas');
  miniFogCanvas.width = MINI_W; miniFogCanvas.height = MINI_H;
  miniFogCtx = miniFogCanvas.getContext('2d');
}

function drawMinimap(pWX, pWY){
  const x0 = W - MINI_W - 12, y0 = 12;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x0-4, y0-4, MINI_W+8, MINI_H+8);
  ctx.strokeStyle = '#8fa6bd'; ctx.lineWidth = 2;
  ctx.strokeRect(x0-4, y0-4, MINI_W+8, MINI_H+8);

  ctx.beginPath(); ctx.rect(x0, y0, MINI_W, MINI_H); ctx.clip();

  // 1) 県境ポリゴンをミニマップサイズに縮小して描画（メインマップと同じ緯度経度→ワールド座標を使い、
  //    ミニマップ用の別スケール・別位置に変換するだけ）
  function toMini(wx, wy){
    return [ x0 + ((wx - worldMinX) / WORLD_W) * MINI_W, y0 + ((wy - worldMinY) / WORLD_H) * MINI_H ];
  }
  ctx.fillStyle = '#123a52'; // 海
  ctx.fillRect(x0, y0, MINI_W, MINI_H);
  ctx.fillStyle = '#3f6b45'; // 陸地
  ctx.beginPath();
  TOKYO_RING.forEach(([lon,lat], i)=>{
    const [mx, my] = toMini(worldX(lon), worldY(lat));
    if(i===0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
  });
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#274a2b'; ctx.lineWidth = 1; ctx.stroke();

  // 2) 探索済み／未探索の霧オーバーレイ（メインマップと共通のmaskCanvasをそのまま使用）
  miniFogCtx.clearRect(0, 0, MINI_W, MINI_H);
  miniFogCtx.fillStyle = 'rgba(4,8,14,0.88)';
  miniFogCtx.fillRect(0, 0, MINI_W, MINI_H);
  miniFogCtx.globalCompositeOperation = 'destination-out';
  miniFogCtx.drawImage(maskCanvas, 0, 0, maskW, maskH, 0, 0, MINI_W, MINI_H);
  miniFogCtx.globalCompositeOperation = 'source-over';
  ctx.drawImage(miniFogCanvas, x0, y0);

  // 3) プレイヤー位置マーカー
  const px = x0 + ((pWX - worldMinX) / WORLD_W) * MINI_W;
  const py = y0 + ((pWY - worldMinY) / WORLD_H) * MINI_H;
  ctx.fillStyle = '#ffd93d';
  ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI*2); ctx.fill();

  ctx.restore();
}

function startQuiz(){ state.mode = 'quiz'; state.quizStep = 0; showQuiz(); }
function showQuiz(){
  const quiz = dummyQuizzes[state.quizStep % dummyQuizzes.length];
  quizQuestion.textContent = quiz.q;
  quizOptions.innerHTML = '';
  quiz.options.forEach((opt, idx)=>{
    const btn = document.createElement('button');
    btn.className = 'quizOption'; btn.textContent = opt;
    btn.addEventListener('click', ()=> answerQuiz(idx === quiz.correctIndex));
    quizOptions.appendChild(btn);
  });
  quizOverlay.classList.add('show');
}
function answerQuiz(correct){
  if(correct){
    state.quizStep++;
    if(state.quizStep >= 2){ quizOverlay.classList.remove('show'); endGame(true); }
    else showQuiz();
  } else {
    state.timeLeft -= 15;
    quizOverlay.classList.remove('show');
    wrongToast.style.display = 'flex';
    setTimeout(()=>{
      wrongToast.style.display = 'none';
      if(state.timeLeft <= 0){ state.timeLeft = 0; endGame(false); }
      else { state.mode = 'playing'; timerEl.textContent = state.timeLeft; }
    }, 900);
  }
}


// ---- ゲーム開始 ----
// 以前はこのファイルの末尾で initGame() と requestAnimationFrame(loop) を直接呼んでいたが、
// 県データを動的に読み込むようにしたため、開始処理は main.js の startGame() に移した
// （index.html の loadPrefectureData() 完了後に呼ばれる）。
