// ======================================================================
// ui.js
// HUD・タイマー表示・ミニマップ・ヒントUI・クイズ画面
// ======================================================================

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

// ==== ボス戦クイズ（問題は main.js の currentKnowledge から出題） ====
// 出題の選び方：
//  1) 掲示板で読んだ問題（readHintIds）のうち、今回のランでまだ出題していないものからランダム
//  2) 該当がなければ、まだ出題していない問題からランダム
//  3) すべて出題済みなら、直前に出題した問題以外からランダム
// 出題した問題は askedIds に入れるので、不正解で別問題に切り替わる時も直前の問題は選ばれない。
function pickNextQuestion(){
  const all = currentKnowledge;
  if(!all.length) return null;
  const notAsked = all.filter(q => !state.askedIds.has(q.id));
  let pool = notAsked.filter(q => state.readHintIds.has(q.id)); // 1)
  if(!pool.length) pool = notAsked;                              // 2)
  if(!pool.length) pool = all.filter(q => q.id !== state.lastAskedId); // 3)
  if(!pool.length) pool = all; // 有効な問題が1問しかない場合のみ（同じ問題を出すしかない）
  return pool[Math.floor(Math.random() * pool.length)];
}
// ✂️50-50：表示順の選択肢から「正解1つ＋不正解からランダムに1つ」だけ残した2択を返す（表示順は保つ）
function applyFiftyFifty(shown, correctText){
  const wrong = shown.filter(o => o !== correctText);
  const keepWrong = wrong[Math.floor(Math.random() * wrong.length)];
  return shown.filter(o => o === correctText || o === keepWrong);
}

function startQuiz(){ state.mode = 'quiz'; state.quizStep = 0; showQuiz(); }
function showQuiz(){
  const q = pickNextQuestion();
  if(!q){ console.error('[quiz] 出題できる問題がありません（currentKnowledgeが空）'); return; }
  state.askedIds.add(q.id);
  state.lastAskedId = q.id;
  state.currentQuiz = {
    id: q.id,
    correctText: knowledgeCorrectText(q),      // 正誤判定は「表示順のインデックス」ではなく正解の文字列で行う（main.js）
    shown: shuffleArray(q.options),             // 出題のたびにFisher-Yatesで並べ替え（元データは書き換えない）
    visible: null,                              // 実際に表示している選択肢（50-50で減る）
    fiftyUsed: false
  };
  state.currentQuiz.visible = state.currentQuiz.shown;
  quizQuestion.textContent = q.question;
  renderQuizOptions();
  quizOverlay.classList.add('show');
}
function renderQuizOptions(){
  const cq = state.currentQuiz;
  quizOptions.innerHTML = '';
  cq.visible.forEach(opt=>{
    const btn = document.createElement('button');
    btn.className = 'quizOption'; btn.textContent = opt;
    btn.addEventListener('click', ()=> answerQuiz(opt === cq.correctText));
    quizOptions.appendChild(btn);
  });
  // ✂️50-50ボタン：所持していて、この問題でまだ使っていない時だけ表示（1問につき1回）
  fiftyFiftyBtn.style.display = (state.fiftyFiftyStock > 0 && !cq.fiftyUsed) ? 'block' : 'none';
}
function useFiftyFifty(){
  const cq = state.currentQuiz;
  if(!cq || state.mode !== 'quiz' || cq.fiftyUsed || state.fiftyFiftyStock <= 0) return;
  state.fiftyFiftyStock--;
  cq.fiftyUsed = true;
  cq.visible = applyFiftyFifty(cq.shown, cq.correctText);
  renderQuizOptions();
}
const fiftyFiftyBtn = document.getElementById('fiftyFiftyBtn');
fiftyFiftyBtn.addEventListener('click', useFiftyFifty);

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

// ==== ヒントUI（ヒント掲示板の表示パネル／読んだヒントの一覧） ====
// 掲示板に触れると openHintPanel() が呼ばれ、半透明パネルを出す（タイマー・操作は止めない）。
// タップ、または CONFIG.HINT_PANEL_SEC 秒で閉じる。
const hintPanel = document.getElementById('hintPanel');
const hintPanelText = document.getElementById('hintPanelText');
let hintPanelTimer = null;
function openHintPanel(text){
  hintPanelText.textContent = text;
  hintPanel.classList.add('show');
  if(hintPanelTimer) clearTimeout(hintPanelTimer);
  hintPanelTimer = setTimeout(closeHintPanel, CONFIG.HINT_PANEL_SEC * 1000);
  refreshHintListButton();
}
function closeHintPanel(){
  hintPanel.classList.remove('show');
  if(hintPanelTimer){ clearTimeout(hintPanelTimer); hintPanelTimer = null; }
}
hintPanel.addEventListener('click', closeHintPanel);

// --- ヒント一覧（独立した機能：不要なら、この節・index.htmlの #hintListBtn / #hintListPanel・CSS・
//     refreshHintListButton() と closeHintList() の呼び出し箇所を削除すれば取り除ける） ---
const hintListBtn = document.getElementById('hintListBtn');
const hintListPanel = document.getElementById('hintListPanel');
const hintListBody = document.getElementById('hintListBody');
const hintListClose = document.getElementById('hintListClose');
function refreshHintListButton(){
  hintListBtn.textContent = '💡 ヒント(' + state.readHintIds.size + ')';
}
function renderHintList(){
  hintListBody.innerHTML = '';
  if(state.readHintIds.size === 0){
    const p = document.createElement('p');
    p.textContent = 'まだヒントを読んでいません。フィールド上の掲示板に近づいてみよう。';
    hintListBody.appendChild(p);
    return;
  }
  let n = 0;
  state.readHintIds.forEach(id=>{
    const q = currentKnowledge.find(k => k.id === id);
    if(!q) return;
    n++;
    const item = document.createElement('div');
    item.className = 'hintListItem';
    item.textContent = n + '. ' + q.hint;
    hintListBody.appendChild(item);
  });
}
function openHintList(){ renderHintList(); hintListPanel.classList.add('show'); }
function closeHintList(){ hintListPanel.classList.remove('show'); }
hintListBtn.addEventListener('click', ()=>{
  if(hintListPanel.classList.contains('show')) closeHintList(); else openHintList();
});
hintListClose.addEventListener('click', closeHintList);

// ラン開始（initGame）時に呼ぶ：表示中のパネル・一覧を閉じ、ボタンの件数を0に戻す
function resetHintUI(){
  closeHintPanel();
  closeHintList();
  refreshHintListButton();
}

// ---- ゲーム開始 ----
// 以前はこのファイルの末尾で initGame() と requestAnimationFrame(loop) を直接呼んでいたが、
// 県データを動的に読み込むようにしたため、開始処理は main.js の startGame() に移した
// （index.html の loadPrefectureData() 完了後に呼ばれる）。
