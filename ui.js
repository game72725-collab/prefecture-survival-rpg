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

// ==== ミニマップ ====
// 県の大きさ・縦横比によらない固定の正方形（CONFIG.MINIMAP_SIZE）。県の外接矩形（ワールドの幅・高さ）を、縦横比を保って
// 正方形に収め、中央に置く（縮尺 miniScale = MINIMAP_SIZE / max(ワールド幅, ワールド高)）。
// 余白（外接矩形の外側）は、未探索の霧と同じ色・同じ不透明度で常に塗る（霧を晴らす書き込みを余白には行わない）ので、
// 余白と未探索は同じ見た目になり、余白の形から県の縦横比を読み取れない。
// 印（プレイヤー・県庁）・県境・探索の跡はすべて、同じ変換 miniX/miniY（ワールド座標→ミニマップ内の座標）を使う。
// ワールドの大きさ・縮尺は県データ読み込み後に確定するため、宣言だけここに置き、initMinimap()（main.jsのstartGame()から1回だけ呼ばれる）で決める。
let MINI_SIZE = 0, miniScale = 1, miniOffX = 0, miniOffY = 0;
let miniRectX0 = 0, miniRectY0 = 0, miniRectX1 = 0, miniRectY1 = 0; // 探索の跡を書ける範囲（県の外接矩形のミニマップ上の位置。画素境界に揃える）
let miniFogCanvas = null, miniFogCtx = null;
let miniMaskCanvas = null, miniMaskCtx = null; // ミニマップの「探索済み」マスク（MINI_SIZE×MINI_SIZE。霧タイルとは別に、同じ書き込みを直接行う）
function initMinimap(){
  MINI_SIZE = Math.max(1, Math.round(CONFIG.MINIMAP_SIZE));
  miniScale = MINI_SIZE / Math.max(WORLD_W, WORLD_H);
  miniOffX = (MINI_SIZE - WORLD_W * miniScale) / 2;
  miniOffY = (MINI_SIZE - WORLD_H * miniScale) / 2;
  // 端の半透明画素（境界がうっすら見える）を作らないよう、画素境界に揃える。細長い県でも最低1pxは確保する
  miniRectX0 = Math.round(miniOffX); miniRectX1 = Math.max(miniRectX0 + 1, Math.round(miniOffX + WORLD_W * miniScale));
  miniRectY0 = Math.round(miniOffY); miniRectY1 = Math.max(miniRectY0 + 1, Math.round(miniOffY + WORLD_H * miniScale));
  miniFogCanvas = document.createElement('canvas');
  miniFogCanvas.width = MINI_SIZE; miniFogCanvas.height = MINI_SIZE;
  miniFogCtx = miniFogCanvas.getContext('2d');
  miniMaskCanvas = document.createElement('canvas');
  miniMaskCanvas.width = MINI_SIZE; miniMaskCanvas.height = MINI_SIZE;
  miniMaskCtx = miniMaskCanvas.getContext('2d');
}
// ワールド座標 → ミニマップ内の座標（左上が(0,0)、一辺 MINI_SIZE）。ミニマップ上の描画はすべてこの変換を使う
function miniX(wx){ return miniOffX + (wx - worldMinX) * miniScale; }
function miniY(wy){ return miniOffY + (wy - worldMinY) * miniScale; }
// ミニマップの探索済みマスクをクリアする（ラン開始・再プレイ・県データの読み込み直しで、霧タイルの破棄と一緒に呼ばれる）
function resetMiniFog(){ if(miniMaskCtx) miniMaskCtx.clearRect(0, 0, MINI_SIZE, MINI_SIZE); }
// 霧を晴らす書き込み（main.js の revealFogAt から呼ばれる）：メインの霧タイルと同じ操作（放射グラデーションの円）を、
// ミニマップの解像度（ワールド→ミニマップの縮尺）で直接行う。以前は、巨大なマスクを毎フレーム縮小コピーして作っていた。
// 描画半径は max(実際の縮尺の半径, CONFIG.MINIMAP_REVEAL_MIN_PX)：大きな県でも探索の跡が見えるようにする。
// 書き込みは県の外接矩形の内側だけに制限する（余白は常に未探索の霧のまま）。
function revealMiniFog(wx, wy){
  if(!miniMaskCtx) return;
  const mx = miniX(wx), my = miniY(wy); // drawMinimap と同じ変換
  const r = Math.max(CONFIG.FOG_REVEAL_RADIUS_BASE_PX * CONFIG.ZOOM_FACTOR * miniScale, CONFIG.MINIMAP_REVEAL_MIN_PX);
  miniMaskCtx.save();
  miniMaskCtx.beginPath();
  miniMaskCtx.rect(miniRectX0, miniRectY0, miniRectX1 - miniRectX0, miniRectY1 - miniRectY0);
  miniMaskCtx.clip();
  const grad = miniMaskCtx.createRadialGradient(mx, my, 0, mx, my, r);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.75, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  miniMaskCtx.fillStyle = grad;
  miniMaskCtx.beginPath();
  miniMaskCtx.arc(mx, my, r, 0, Math.PI*2);
  miniMaskCtx.fill();
  miniMaskCtx.restore();
}

function drawMinimap(pWX, pWY){
  const x0 = W - MINI_SIZE - 12, y0 = 12;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x0-4, y0-4, MINI_SIZE+8, MINI_SIZE+8);
  ctx.strokeStyle = '#8fa6bd'; ctx.lineWidth = 2;
  ctx.strokeRect(x0-4, y0-4, MINI_SIZE+8, MINI_SIZE+8);

  ctx.beginPath(); ctx.rect(x0, y0, MINI_SIZE, MINI_SIZE); ctx.clip();

  // 1) 県境ポリゴンをミニマップサイズに縮小して描画（メインマップと同じ緯度経度→ワールド座標を使い、
  //    ミニマップ用の別スケール・別位置に変換するだけ）。海は余白も含む正方形の全面に塗る。
  ctx.fillStyle = '#123a52'; // 海（余白もこの色。上に未探索の霧が掛かる）
  ctx.fillRect(x0, y0, MINI_SIZE, MINI_SIZE);
  ctx.fillStyle = '#3f6b45'; // 陸地
  ctx.beginPath();
  PREFECTURE_RING.forEach(([lon,lat], i)=>{
    const mx = x0 + miniX(worldX(lon)), my = y0 + miniY(worldY(lat));
    if(i===0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
  });
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#274a2b'; ctx.lineWidth = 1; ctx.stroke();

  // 2) 探索済み／未探索／余白の霧オーバーレイ（ミニマップ専用の探索済みマスク miniMaskCanvas を使用）。
  //    霧は正方形の全面に掛け、探索済みの部分だけ消す。マスクは外接矩形の内側にしか書かれないので、余白は常に未探索と同じ霧のまま。
  miniFogCtx.clearRect(0, 0, MINI_SIZE, MINI_SIZE);
  miniFogCtx.fillStyle = 'rgba(4,8,14,0.88)';
  miniFogCtx.fillRect(0, 0, MINI_SIZE, MINI_SIZE);
  miniFogCtx.globalCompositeOperation = 'destination-out';
  miniFogCtx.drawImage(miniMaskCanvas, 0, 0);
  miniFogCtx.globalCompositeOperation = 'source-over';
  ctx.drawImage(miniFogCanvas, x0, y0);

  // 3) 🧭県庁サーチ発動中：県庁の印（ピンクの星）。霧オーバーレイの「上」に重ねる。
  //    座標は下のプレイヤー印と同じ変換（ワールド座標→ミニマップ）で、県庁のワールド座標から求める
  if(state.compassActive){
    const cx = x0 + miniX(worldX(state.boss.lon));
    const cy = y0 + miniY(worldY(state.boss.lat));
    ctx.beginPath();
    for(let i = 0; i < 10; i++){
      const rad = (i % 2 === 0) ? 6 : 2.6;
      const ang = -Math.PI/2 + i * Math.PI/5;
      const sx = cx + Math.cos(ang) * rad, sy = cy + Math.sin(ang) * rad;
      if(i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fillStyle = '#ff2d95'; ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  // 4) プレイヤー位置マーカー
  const px = x0 + miniX(pWX);
  const py = y0 + miniY(pWY);
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
  return pool[Math.floor(gameRandom() * pool.length)];
}
// ✂️50-50：表示順の選択肢から「正解1つ＋不正解からランダムに1つ」だけ残した2択を返す（表示順は保つ）
function applyFiftyFifty(shown, correctText){
  const wrong = shown.filter(o => o !== correctText);
  const keepWrong = wrong[Math.floor(gameRandom() * wrong.length)];
  return shown.filter(o => o === correctText || o === keepWrong);
}

function startQuiz(){
  state.mode = 'quiz'; state.quizStep = 0;
  updateHintButtonVisibility(); // ボス戦中はヒントボタン非表示（開いているパネル・一覧も閉じる）
  showQuiz();
}
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
  renderFiftyFiftyBtn();
}
// ✂️50-50ボタン：ボス戦（クイズ画面）の中だけに存在する。所持数を表示し、0個またはこの問題で使用済みなら押せない表示にする
function renderFiftyFiftyBtn(){
  const cq = state.currentQuiz;
  const usable = state.fiftyFiftyStock > 0 && !cq.fiftyUsed;
  fiftyFiftyBtn.style.display = 'block';
  fiftyFiftyBtn.disabled = !usable;
  fiftyFiftyBtn.textContent = (cq.fiftyUsed ? '✂️ 50-50 使用済み' : '✂️ 50-50（2択にする）') + '　所持 ×' + state.fiftyFiftyStock;
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
      else { state.mode = 'playing'; timerEl.textContent = state.timeLeft; updateHintButtonVisibility(); } // フィールドに戻る
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
  updateHintButtonVisibility();
}
// ヒントボタンはフィールドで遊んでいる間（state.mode === 'playing'）だけ表示する。
// ボス戦（quiz）に入った時・ゲーム終了時は非表示にし、開いているヒントパネル／一覧も同時に閉じる。
// 読了記録（state.readHintIds）はここでは触らない（ボス戦の出題の優先判定に使うため保持する）。
function updateHintButtonVisibility(){
  const visible = state.mode === 'playing';
  hintListBtn.style.display = visible ? '' : 'none';
  if(!visible){ closeHintPanel(); closeHintList(); }
}

// ---- ゲーム開始 ----
// 以前はこのファイルの末尾で initGame() と requestAnimationFrame(loop) を直接呼んでいたが、
// 県データを動的に読み込むようにしたため、開始処理は main.js の startGame() に移した
// （index.html の loadPrefectureData() 完了後に呼ばれる）。
