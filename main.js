// ======================================================================
// main.js
// ゲームループ・状態管理・初期化を担当。CONFIG／canvas・ctx・DOM要素／ワールド座標系（worldX・worldY等）／
// Fog of War／state／update()・draw()・initGame()・loop() など、他ファイルが共通して使う土台もここに置いている。
// ※ terrain.js / player.js / items.js / ui.js より先に読み込まれる前提（index.htmlの読み込み順を参照）。
// ======================================================================

// ==== 画像アセット読み込み（失敗しても図形フォールバックする） ====
// 宝箱（未開封）の元画像はアルファチャンネルを持たない不透明PNG（黒背景が実ピクセルとして焼き込まれている）ため、
// 読み込み後にcanvas上で「ほぼ黒のピクセルだけ透明化」するチェーマキー処理を行い、
// 本来の絵柄（同じ画像素材）はそのままに透過だけを復元する。
function chromaKeyBlack(img, done){
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const cctx = c.getContext('2d');
  cctx.drawImage(img, 0, 0);
  const data = cctx.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  for(let i=0; i<d.length; i+=4){
    const sum = d[i] + d[i+1] + d[i+2];
    if(sum <= 15) d[i+3] = 0;
    else if(sum <= 45) d[i+3] = Math.round(255 * (sum-15) / 30); // 縁を少しなじませる
  }
  cctx.putImageData(data, 0, 0);
  done(c);
}
function loadImg(src, processFn){
  const img = new Image();
  img.ready = false;
  img.onload = ()=>{
    if(processFn){ processFn(img, (canvas)=>{ img.renderSource = canvas; img.ready = true; }); }
    else { img.renderSource = img; img.ready = true; }
  };
  img.onerror = ()=>{ img.ready = false; };
  img.src = src;
  return img;
}
function srcSize(s){ return (s.naturalWidth !== undefined) ? [s.naturalWidth, s.naturalHeight] : [s.width, s.height]; }

const IMG_CAPITAL = loadImg('assets/capital.png'); // 元々アルファ有りなので加工不要

// ==== 地形テクスチャ（建物用地・河川湖沼・森林・田・その他農地・荒地・ゴルフ場・海浜）：
//      ワールド座標に固定したCanvasPatternとして使う ====
// パターンはcanvasの現在の変形（ctx.translate）に追従して敷き詰められるため、
// 「ワールド座標の原点」を基準にtranslateしてから塗ることで、セルをまたいでも模様が継ぎ目なく連続する。
const CONFIG = {
  // ---- 県の選択・開発用 ----
  FORCE_PREFECTURE_CODE: null, // 数値（例：13）を入れると、その県で開始（data/available_prefs.js の一覧に含まれる場合のみ有効）。null ならURLの?pref=NN、無ければ一覧からランダム
  DEBUG: false,                // true の時だけ、開発確認用の console.log と、画面隅の dt(ms)・FPS 表示を出す。URLに ?debug=1 を付けても true になる（県コードなどは画面には一切出さない）
  DT_MAX_SEC: 0.05,            // 1フレームのdt（秒）の上限。タブ復帰や重い処理の直後に、大きな値で一気に動かないようにする（0.05秒＝20fps相当）
  MAX_STEP_PX: 8,              // 移動の1サブステップの最大量(px)。1フレームの移動量がこれを超える時は等分して、各サブステップで通行判定・県境判定をやり直す（すり抜け防止）
  ZOOM_FACTOR: 1.4,        // 画面表示の拡大率。緯度経度→画面座標の変換すべてに掛かる
  SPEED_NORMAL: 3.4,       // 通常地形（建物用地・道路・鉄道・農地・その他など）での移動速度（ズーム未適用の基準値）
  SPEED_FOREST_MULT: 0.5,  // 森林（0500）での速度倍率
  RIVER_SPEED_MULTIPLIER: 0.28, // 河川地及び湖沼（1100）での速度倍率（森林よりさらに遅い）
  SPEED_BIKE_MULT: 1.7,    // スピードアップ発動中の速度倍率。地形の速度倍率に「掛け算」で重ねる
  ANIM_FRAME_MS_NORMAL: 70,  // ランニングのコマ送り間隔
  ANIM_FRAME_MS_FOREST: 110, // 山歩行のコマ送り間隔
  ANIM_FRAME_MS_BIKE: 45,    // 自転車のコマ送り間隔（素材が無い間はランニング素材を高速コマ送り）
  ANIM_FRAME_MS_KAYAK: 90,   // カヤックのコマ送り間隔
  BIKE_DURATION_SEC: 10,     // スピードアップの効果時間（秒）。発動中に再取得すると、この値に戻る（加算はしない）
  // 宝箱の中身の抽選の重み（合計に対する割合で出る）。🧭県庁サーチは、発動済み／同じラン内で既に1つ割り当て済みなら抽選から外れる（items.js の pickChestItem）
  CHEST_ITEM_WEIGHTS: { time: 35, speed: 25, fifty: 25, compass: 15 }, // time=⏱+10秒 / speed=👟スピードアップ / fifty=✂️50-50 / compass=🧭県庁サーチ
  DEBUG_FORCE_ITEM: null,    // 'speed' / 'time' / 'fifty' / 'compass' のどれかにすると全宝箱がそのアイテムになる。null で通常（重み抽選）
  // ---- ヒント掲示板 ----
  HINT_BOARD_COUNT: 4,       // ステージ開始時に置く掲示板の数。旧ヒント宝箱は「近距離2＋遠距離1〜2＝3〜4個」だったため最大の4に合わせた。有効な問題数がこれより少なければ問題数に合わせる
  HINT_BOARD_SIZE: 60,       // 掲示板の表示高さ(px)
  HINT_BOARD_DIST_MIN_KM: 0.15, HINT_BOARD_DIST_MAX_KM: 3.0, // スポーン地点からの配置距離(km)。旧・近距離枠(0.15〜0.9)と遠距離枠(1.2〜3.0)を、区別なしの1範囲に統合
  HINT_PANEL_SEC: 8,         // ヒント表示パネルが自動で閉じるまでの秒数（タップでも閉じる）
  // シートごとの表示調整。scale＝PLAYER_SIZEに掛ける倍率、yOffset＝足元位置の下方向ずらし(px)。
  // 人物の大きさ・足元が歩き／走りとずれる素材はここで合わせる。
  SHEET_ADJUST: {
    walk:  { scale: 1.0,  yOffset: 0 },
    run:   { scale: 1.0,  yOffset: 0 },
    kayak: { scale: 1.3,  yOffset: 25 }, // 船が人物より大きいので、人物の頭の大きさが走りと揃うよう拡大＋座っている人が同じ高さに来るよう下げる
    bike:  { scale: 1.3,  yOffset: 25 }, // カヤックと同様、乗り物の縦幅が大きい素材のため拡大＋下寄せ
  },
  FOG_REVEAL_RADIUS_BASE_PX: 190, // 霧の解除半径（ズーム未適用の基準値。ワールドピクセル単位）
  PLAYER_SIZE: 100,        // 探検家の表示高さ(px)
  CHEST_SIZE: 60,          // 宝箱（未開封）の表示高さ(px)。開封中はこの1.15倍を使用
  CAPITAL_SIZE: 100,       // 県庁の表示高さ(px)
  CAMERA_ZOOM_MIN: 1.0,    // ピンチズームの下限（初期表示＝1.0。これより引くことはできない）
  CAMERA_ZOOM_MAX: 3.5,    // ピンチズームの上限（拡大側）
  PINCH_INVERT: false,     // true にすると指の開閉とズーム方向が逆になる（既定：指を広げる＝拡大）
};
let cameraZoom = 1.0;
// URLに ?debug=1 が付いていたら CONFIG.DEBUG を true にする（実機でdtやリフレッシュレート(60/90/120Hz)を確認するため）
if(new URLSearchParams(window.location.search).get('debug') === '1') CONFIG.DEBUG = true;
// 開発確認用のログ。CONFIG.DEBUG が真の時だけ出す（通常は何も出さない）
function debugLog(){ if(CONFIG.DEBUG) console.log.apply(console, arguments); }

// ==== 県ごとのワールド座標系 ====
// 県データ（data/pref<コード>/data_mesh.js の PREFECTURE_RING 等）が読み込まれてから初めて決まる値なので、
// ここでは宣言だけ行い、setupWorldCoordinates() が読み込み完了後に一度だけ値を入れる。
// （他ファイルからは従来と同じ名前でそのまま参照できる）
let lonMin=Infinity, lonMax=-Infinity, latMin=Infinity, latMax=-Infinity;
let REF_LAT, REF_LON, PX_PER_DEG_LAT, PX_PER_DEG_LON;
const MARGIN_DEG = 0.03;
let worldMinX, worldMaxX, worldMinY, worldMaxY, WORLD_W, WORLD_H;
let OTHER_PREF_RINGS_WORLD = [];
function worldX(lon){ return (lon - REF_LON) * PX_PER_DEG_LON; }
function worldY(lat){ return -(lat - REF_LAT) * PX_PER_DEG_LAT; }

function setupWorldCoordinates(){
  lonMin=Infinity; lonMax=-Infinity; latMin=Infinity; latMax=-Infinity;
  PREFECTURE_RING.forEach(([lon,lat])=>{
    if(lon<lonMin) lonMin=lon; if(lon>lonMax) lonMax=lon;
    if(lat<latMin) latMin=lat; if(lat>latMax) latMax=lat;
  });
  REF_LAT = (latMin+latMax)/2;
  REF_LON = (lonMin+lonMax)/2;
  // ①ズーム倍率：緯度経度→画面座標の変換すべて（worldX/worldY）に一括で掛かるよう、基準のpx/度に直接乗算する
  PX_PER_DEG_LAT = 8000 * CONFIG.ZOOM_FACTOR;
  PX_PER_DEG_LON = PX_PER_DEG_LAT * Math.cos(REF_LAT * Math.PI/180);

  worldMinX = worldX(lonMin-MARGIN_DEG); worldMaxX = worldX(lonMax+MARGIN_DEG);
  worldMinY = worldY(latMax+MARGIN_DEG); worldMaxY = worldY(latMin-MARGIN_DEG);
  WORLD_W = worldMaxX - worldMinX; WORLD_H = worldMaxY - worldMinY;

  // 東京都以外の都道府県ポリゴン：フラット配列を [ [ [wx,wy], ... ], ... ] のワールド座標リングに変換（一度だけ）
  OTHER_PREF_RINGS_WORLD = OTHER_PREF_RINGS_FLAT.map(flat=>{
    const ring = [];
    for(let i=0;i<flat.length;i+=2){ ring.push([worldX(flat[i]), worldY(flat[i+1])]); }
    return ring;
  });
}

// 東京都の土地利用を、起動時に一度だけオフスクリーンcanvasへラスター化しておく（毎フレームの193,000セル描画を避けるため）
const KM_PER_DEG_LAT = 111;
function kmPerDegLonAt(latDeg){ return 111 * Math.cos(latDeg * Math.PI/180); }

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvasWrap');
const timerEl = document.getElementById('timer');
const chestCountEl = document.getElementById('chestCount');
const chestTotalEl = document.getElementById('chestTotal');
const hintBanner = document.getElementById('hintBanner');
const boostHud = document.getElementById('boostHud'), boostBar = document.getElementById('boostBar'), boostSec = document.getElementById('boostSec');

const quizOverlay = document.getElementById('quizOverlay');
const quizQuestion = document.getElementById('quizQuestion');
const quizOptions = document.getElementById('quizOptions');
const gameOverOverlay = document.getElementById('gameOverOverlay');
const clearOverlay = document.getElementById('clearOverlay');
const wrongToast = document.getElementById('wrongToast');

let W = 0, H = 0;
let fogCanvas, fogCtx;

// Fog of War 用マスク（ワールド全体を縮小解像度で保持。晴らした場所は永続的に白く塗る）
const FOG_RES_SCALE = 0.2;
let maskCanvas, maskCtx, maskW, maskH;

function resize(){
  W = wrap.clientWidth; H = wrap.clientHeight;
  canvas.width = W; canvas.height = H;
  fogCanvas = document.createElement('canvas');
  fogCanvas.width = W; fogCanvas.height = H;
  fogCtx = fogCanvas.getContext('2d');
}
window.addEventListener('resize', resize);

function initFogMask(){
  maskW = Math.max(1, Math.ceil(WORLD_W * FOG_RES_SCALE));
  maskH = Math.max(1, Math.ceil(WORLD_H * FOG_RES_SCALE));
  maskCanvas = document.createElement('canvas');
  maskCanvas.width = maskW; maskCanvas.height = maskH;
  maskCtx = maskCanvas.getContext('2d');
}

function worldToMask(wx, wy){
  return [(wx - worldMinX) * FOG_RES_SCALE, (wy - worldMinY) * FOG_RES_SCALE];
}

function revealFogAt(wx, wy){
  const [mx, my] = worldToMask(wx, wy);
  // 霧の解除半径はZOOM_FACTORに連動（ズームしても現実換算の視界範囲が変わらないようにする）
  const r = CONFIG.FOG_REVEAL_RADIUS_BASE_PX * CONFIG.ZOOM_FACTOR * FOG_RES_SCALE;
  const grad = maskCtx.createRadialGradient(mx, my, 0, mx, my, r);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.75, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  maskCtx.fillStyle = grad;
  maskCtx.beginPath();
  maskCtx.arc(mx, my, r, 0, Math.PI*2);
  maskCtx.fill();
}

const PLAYER_R_PX = 14, CHEST_SIZE_PX = 24, BOSS_SIZE_PX = 30;
const PICKUP_DIST_PX = PLAYER_R_PX + CHEST_SIZE_PX/2;
const BOSS_DIST_PX = PLAYER_R_PX + BOSS_SIZE_PX/2;
const CHEST_OPEN_FRAME_MS = 80; // スプライトシート1コマの表示時間
const CHEST_OPEN_ANIM_MS = CHEST_OPEN_FRAME_MS * 9; // 9コマ分

let state = {};

function randRange(min, max){ return Math.random() * (max - min) + min; }
// Fisher-Yatesシャッフル。元の配列は書き換えず、シャッフル済みの新しい配列を返す
function shuffleArray(arr){
  const a = arr.slice();
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function distPx(ax, ay, bx, by){ return Math.hypot(ax-bx, ay-by); }
function clampToBounds(lat, lon){
  return {
    lat: Math.max(latMin-MARGIN_DEG, Math.min(latMax+MARGIN_DEG, lat)),
    lon: Math.max(lonMin-MARGIN_DEG, Math.min(lonMax+MARGIN_DEG, lon))
  };
}
// 東京都の輪郭（PREFECTURE_RING）に対するpoint-in-polygon判定（標準的なレイキャスティング法）。
// PREFECTURE_RINGは[lon,lat]の配列。境界の外に出られないようにするための正式な判定で、
// 従来のclampToBounds（単純な外接長方形）はこの後段の簡易フォールバックとしてそのまま残す。
function isInsidePrefecture(lat, lon){
  let inside = false;
  const ring = PREFECTURE_RING;
  for(let i=0, j=ring.length-1; i<ring.length; j=i++){
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if(intersect) inside = !inside;
  }
  return inside;
}
// 中心座標から距離distKm・角度angleRad(0=北,時計回り)だけ離れた緯度経度を返す
function offsetLatLon(centerLat, centerLon, distKm, angleRad){
  const dLatKm = distKm * Math.cos(angleRad);
  const dLonKm = distKm * Math.sin(angleRad);
  const lat = centerLat + dLatKm / KM_PER_DEG_LAT;
  const lon = centerLon + dLonKm / kmPerDegLonAt(centerLat);
  return clampToBounds(lat, lon);
}

// 宝箱の中身：'time'（+10秒）／'speed'（スピードアップ）／'fifty'（✂️50-50）／'compass'（🧭県庁サーチ）。抽選は items.js の pickChestItem()。
function initGame(){
  resize();
  initFogMask();

  // ① スポーン地点：県庁から直線距離1〜3km圏内のランダムな地点
  const spawnDist = randRange(1, 3);
  const spawnAngle = randRange(0, Math.PI*2);
  const spawn = offsetLatLon(CAPITAL.lat, CAPITAL.lon, spawnDist, spawnAngle);

  state = {
    player: { lat: spawn.lat, lon: spawn.lon },
    spawn: { lat: spawn.lat, lon: spawn.lon },
    chests: [],
    boss: { lat: CAPITAL.lat, lon: CAPITAL.lon, sizePx: BOSS_SIZE_PX },
    timeLeft: 90,
    speedBoostUntil: 0, // スピードアップの終了時刻(performance.now基準)。0＝非発動
    running: true,
    mode: 'playing',
    quizStep: 0,
    hintBoards: [],        // ヒント掲示板（placeHintBoards）
    readHintIds: new Set(), // 今回のランで掲示板から読んだ問題ID（ラン開始ごとにリセット）
    askedIds: new Set(),    // 今回のランでボス戦に出題済みの問題ID（ラン開始ごとにリセット）
    lastAskedId: null,      // 直前に出題した問題ID
    currentQuiz: null,      // 出題中の問題（シャッフル後の選択肢・正解文字列など）
    fiftyFiftyStock: 0,     // ✂️50-50の所持数（ラン開始で0にリセット）
    compassActive: false    // 🧭県庁サーチが発動済みか（ラン開始で未発動にリセット）
  };

  // 宝箱の中身を抽選する。🧭は1つ割り当てたら、同じラン内の残りの宝箱の抽選から外す（2個目は意味がないため）
  let compassTaken = state.compassActive;
  const rollChestItem = ()=>{
    const it = pickChestItem(compassTaken);
    if(it === 'compass') compassTaken = true;
    return it;
  };

  // ⑤ 宝箱：スポーン地点からの距離で「近距離枠」「遠距離枠」を分けて配置
  const NEAR_COUNT = 2;
  const FAR_COUNT = Math.random() < 0.5 ? 1 : 2;
  for(let i=0;i<NEAR_COUNT;i++){
    const d = randRange(0.15, 0.9);
    const a = randRange(0, Math.PI*2);
    const p = offsetLatLon(spawn.lat, spawn.lon, d, a);
    state.chests.push({ lat:p.lat, lon:p.lon, category:'near', item: rollChestItem(), state:'closed', openStart:0 });
  }
  for(let i=0;i<FAR_COUNT;i++){
    const d = randRange(1.2, 3.0);
    const a = randRange(0, Math.PI*2);
    const p = offsetLatLon(spawn.lat, spawn.lon, d, a);
    state.chests.push({ lat:p.lat, lon:p.lon, category:'far', item: rollChestItem(), state:'closed', openStart:0 });
  }
  chestTotalEl.textContent = state.chests.length;
  chestCountEl.textContent = 0;

  // ヒント掲示板：ナレッジ（有効な問題）から重複なしでN問を選び、1問につき1つ配置（items.js）
  state.hintBoards = placeHintBoards(spawn);

  hideAllOverlays();
  resetHintUI(); // ヒントのパネル／一覧／ボタン表示を初期状態へ（ui.js）
  boostHud.classList.remove('show');
  revealFogAt(worldX(spawn.lon), worldY(spawn.lat)); // スポーン地点周辺は最初から視界を確保
  lastTime = performance.now();
}

function setCameraZoom(v){ cameraZoom = Math.max(CONFIG.CAMERA_ZOOM_MIN, Math.min(CONFIG.CAMERA_ZOOM_MAX, v)); }
let pinchStartDist = 0, pinchStartZoom = 1;
const touchDist = (t)=> Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
canvas.addEventListener('touchstart', (e)=>{
  e.preventDefault();
  if(e.targetTouches.length === 2){ pinchStartDist = touchDist(e.targetTouches); pinchStartZoom = cameraZoom; }
}, {passive:false});
canvas.addEventListener('touchmove', (e)=>{
  e.preventDefault();
  if(e.targetTouches.length === 2 && pinchStartDist > 0){
    let ratio = touchDist(e.targetTouches) / pinchStartDist; // >1：指を広げた
    if(CONFIG.PINCH_INVERT) ratio = 1 / ratio;
    setCameraZoom(pinchStartZoom * ratio);
  }
}, {passive:false});
const endPinch = ()=>{ pinchStartDist = 0; };
canvas.addEventListener('touchend', endPinch);
canvas.addEventListener('touchcancel', endPinch);
// PCでの動作確認用：マウスホイールでも同じズームを操作できる
canvas.addEventListener('wheel', (e)=>{ e.preventDefault(); setCameraZoom(cameraZoom * (e.deltaY < 0 ? 1.1 : 1/1.1)); }, {passive:false});

let lastTime = 0, timeAccum = 0;

// update(dtSec, rawMs)
//   dtSec：このフレームの経過時間（秒）。上限 CONFIG.DT_MAX_SEC で頭打ち済み（loop()が計算）。移動・コマ送りなど「見た目の進行」に使う。
//   rawMs：前フレームからの実経過時間（ミリ秒、頭打ちなし）。残り時間タイマー専用（従来どおり実時間で減らす）。省略時は dtSec*1000。
// 既存のCONFIG値（SPEED_NORMAL等）は「60fps換算の1フレームあたり」の意味のままなので、
// 1フレームあたりの量には dtScale（= dtSec × 60。60Hzでは≒1）を掛ける。
function update(dtSec, rawMs){
  if(rawMs === undefined) rawMs = dtSec * 1000;
  const dtScale = dtSec * 60;
  if(state.mode === 'gameover' || state.mode === 'clear') return;

  // タイマーは mode に関わらず常に進行（クイズ中も止めない）。実時間（rAFタイムスタンプの差）で減らす＝リフレッシュレートに依存しない
  timeAccum += rawMs;
  if(timeAccum >= 1000){
    timeAccum -= 1000;
    state.timeLeft -= 1;
    if(state.timeLeft <= 0){
      state.timeLeft = 0; timerEl.textContent = 0;
      endGame(false); return;
    }
  }
  timerEl.textContent = state.timeLeft;
  timerEl.parentElement.classList.toggle('low', state.timeLeft <= 10);

  // 宝箱の開封アニメ終了処理（mode不問）
  const now = performance.now();
  state.chests.forEach(c=>{
    if(c.state === 'opening' && now - c.openStart > CHEST_OPEN_ANIM_MS) c.state = 'gone';
  });
  updateBoostHud(now);

  if(state.mode !== 'playing') return;

  let dx=0, dy=0;
  if(keys.up) dy -= 1; if(keys.down) dy += 1;
  if(keys.left) dx -= 1; if(keys.right) dx += 1;
  if(dx!==0 && dy!==0){ dx*=0.7071; dy*=0.7071; }

  // 現在地の地形から、このフレームの速度・アニメーションを決定する
  const landCode = getLanduseCode(state.player.lat, state.player.lon);
  const boosting = now < state.speedBoostUntil;
  let speedMult = 1;
  let targetSheet = SHEET_PLAYER_RUN, frameMs = CONFIG.ANIM_FRAME_MS_NORMAL;
  if(landCode === LANDUSE_FOREST){
    speedMult = CONFIG.SPEED_FOREST_MULT;
    targetSheet = SHEET_PLAYER_WALK; frameMs = CONFIG.ANIM_FRAME_MS_FOREST;
  } else if(landCode === LANDUSE_RIVER){
    speedMult = CONFIG.RIVER_SPEED_MULTIPLIER; // 森林よりさらに遅い
    targetSheet = SHEET_PLAYER_KAYAK; frameMs = CONFIG.ANIM_FRAME_MS_KAYAK; // 川ではカヤック表示（スピードアップ中も優先）
  }
  if(boosting){
    speedMult *= CONFIG.SPEED_BIKE_MULT; // 地形の倍率の上に掛け算で重ねる
    if(landCode !== LANDUSE_RIVER){
      // 自転車の素材シートがまだ無い／読めない間は、ランニング素材を高速コマ送りで代用する
      targetSheet = SHEET_PLAYER_BIKE.ready ? SHEET_PLAYER_BIKE : SHEET_PLAYER_RUN;
      frameMs = CONFIG.ANIM_FRAME_MS_BIKE;
    }
  }
  // ②ズーム連動：ZOOM_FACTORが上がるほど画面上のpxあたりの実距離が縮むため、
  // 現実換算の移動速度を保つよう基準速度にもZOOM_FACTORを掛ける
  const speed = CONFIG.SPEED_NORMAL * CONFIG.ZOOM_FACTOR * speedMult;

  // 探検家のアニメーション：移動中のみコマを進め、止まっている間は先頭コマで静止。地形が変わったらリセット。
  if(targetSheet !== playerAnimSheet){ playerAnimSheet = targetSheet; playerAnimFrame = 0; playerAnimAccum = 0; }
  if(dx!==0 || dy!==0){
    playerAnimAccum += dtSec * 1000; // コマ送りはミリ秒単位の経過時間で進める（フレーム数ではない）
    while(playerAnimAccum >= frameMs){
      playerAnimAccum -= frameMs;
      playerAnimFrame = (playerAnimFrame + 1) % playerAnimSheet.frameCount;
    }
  } else {
    playerAnimAccum = 0;
    playerAnimFrame = 0;
  }

  // 移動量：speed は「60fps換算の1フレームあたり(px)」なので dtScale を掛ける（60Hzでは dtScale≒1 で従来と同じ）。
  // 1フレームの移動量が MAX_STEP_PX を超える時は steps 個に等分し、サブステップごとに通行判定・県境判定を行う（すり抜け防止）。
  // ただし dtScale が 1（＝60fps換算の1フレーム）以下なら、移動量は従来のゲームが1ステップで動かしていた量を超えないので、
  // 常に1ステップのまま（バイク時の約8.1pxが MAX_STEP_PX=8 をわずかに超えても、60Hzの挙動を従来と完全に同じに保つため）。
  // 1.001 は浮動小数点の誤差・タイムスタンプの微小なぶれを吸収する許容値。
  const framePx = speed * dtScale;
  const steps = (dtScale <= 1.001) ? 1 : Math.max(1, Math.ceil(framePx / CONFIG.MAX_STEP_PX));
  const dLon = (dx * speed * dtScale / steps) / PX_PER_DEG_LON;
  const dLat = -(dy * speed * dtScale / steps) / PX_PER_DEG_LAT;
  // X・Yを別々に判定することで、壁（進入不可地形・県境の外）に沿って滑るように移動できる。
  // 地形の通行可否（isPassable）に加えて、県の輪郭の内側かどうか（isInsidePrefecture）も両方満たす必要がある。
  for(let s = 0; s < steps; s++){
    if(dLon !== 0){
      const tryLon = state.player.lon + dLon;
      if(isPassable(state.player.lat, tryLon) && isInsidePrefecture(state.player.lat, tryLon)) state.player.lon = tryLon;
    }
    if(dLat !== 0){
      const tryLat = state.player.lat + dLat;
      if(isPassable(tryLat, state.player.lon) && isInsidePrefecture(tryLat, state.player.lon)) state.player.lat = tryLat;
    }
  }
  const clamped = clampToBounds(state.player.lat, state.player.lon);
  state.player.lat = clamped.lat; state.player.lon = clamped.lon;

  const pWX = worldX(state.player.lon), pWY = worldY(state.player.lat);

  // ② Fog of War：現在地周辺の霧を晴らす（永続）
  revealFogAt(pWX, pWY);

  // 宝箱取得判定
  state.chests.forEach(c=>{
    if(c.state !== 'closed') return;
    const cWX = worldX(c.lon), cWY = worldY(c.lat);
    if(distPx(pWX, pWY, cWX, cWY) < PICKUP_DIST_PX){
      c.state = 'opening';
      c.openStart = now;
      const opened = state.chests.filter(cc=>cc.state !== 'closed').length;
      chestCountEl.textContent = opened;
      // 🧭が出たが既に発動済みなら、別のアイテムに引き直す
      if(c.item === 'compass' && state.compassActive) c.item = pickChestItem(true);
      applyChestItem(c.item); // items.js：time / speed / fifty / compass の効果とメッセージ
    }
  });

  // ヒント掲示板の取得判定（触れたら問題のhintを表示し、掲示板は消える）
  checkHintBoardPickup(pWX, pWY);

  // 県庁到達判定
  const bWX = worldX(state.boss.lon), bWY = worldY(state.boss.lat);
  if(distPx(pWX, pWY, bWX, bWY) < BOSS_DIST_PX){
    startQuiz();
  }
}

// ==== 画像 or フォールバック図形の描画ヘルパー ====
// targetH（表示高さ）だけ指定し、幅は元画像の縦横比から自動計算する（引き伸ばし防止）
function draw(){
  ctx.clearRect(0,0,W,H);
  const pWX = worldX(state.player.lon), pWY = worldY(state.player.lat);
  function toScreen(wx, wy){ return [ W/2 + (wx - pWX), H/2 + (wy - pWY) ]; }
  const z = cameraZoom;
  // ここから探検家の描画までを、画面中央（＝プレイヤー）を中心にz倍する。霧・ミニマップ（UI）はスケールしない。
  ctx.save();
  ctx.translate(W/2, H/2); ctx.scale(z, z); ctx.translate(-W/2, -H/2);

  // 海（背景全体）
  ctx.fillStyle = '#123a52';
  ctx.fillRect(0,0,W,H);

  // 東京都以外の都道府県：地味な単色でベタ塗りするだけ（装飾なし）
  ctx.save();
  ctx.fillStyle = '#3a453e';
  OTHER_PREF_RINGS_WORLD.forEach(ring=>{
    ctx.beginPath();
    ring.forEach(([wx,wy], i)=>{
      const sx = W/2 + (wx - pWX), sy = H/2 + (wy - pWY);
      if(i===0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();

  // 東京都：起動時に事前ラスター化した土地利用カラーマップを、PREFECTURE_RINGでクリップして描画
  ctx.save();
  ctx.beginPath();
  PREFECTURE_RING.forEach(([lon,lat], i)=>{
    const [sx, sy] = toScreen(worldX(lon), worldY(lat));
    if(i===0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
  ctx.clip();
  // テクスチャONなら焼き付け済みラスターを使い、未生成（読み込み中）・OFF・描画失敗時は通常ラスターへ戻す。
  // ここが今回のバグ：texturedLanduseRasterCanvasが無い場合（テクスチャOFF時・焼き込み完了前）に
  // どちらのdrawImageも呼ばれず、下地が全く描かれていなかった。rasterDrawnで確実にフォールバックする。
  let rasterDrawn = false;
  if(toggleTexture.checked && texturedLanduseRasterCanvas){
    try {
      const rasterOriginScreenX = W/2 + (texturedLanduseRasterOriginX - pWX);
      const rasterOriginScreenY = H/2 + (texturedLanduseRasterOriginY - pWY);
      ctx.drawImage(
        texturedLanduseRasterCanvas,
        rasterOriginScreenX,
        rasterOriginScreenY,
        texturedLanduseRasterCanvas.width / TEXTURED_LANDUSE_RASTER_SCALE,
        texturedLanduseRasterCanvas.height / TEXTURED_LANDUSE_RASTER_SCALE
      );
      rasterDrawn = true;
    } catch(e) {
      rasterDrawn = false; // 下のフォールバックに任せる
    }
  }
  if(!rasterDrawn && landuseRasterCanvas){
    // テクスチャOFF、まだ焼き込みが終わっていない、または上で失敗した場合はここで必ず単色ラスターを描く
    const rasterOriginScreenX = W/2 + (landuseRasterOriginX - pWX);
    const rasterOriginScreenY = H/2 + (landuseRasterOriginY - pWY);
    ctx.drawImage(
      landuseRasterCanvas,
      rasterOriginScreenX,
      rasterOriginScreenY,
      landuseRasterCanvas.width / LANDUSE_RASTER_SCALE,
      landuseRasterCanvas.height / LANDUSE_RASTER_SCALE
    );
  }
  ctx.restore();
  // 東京都の輪郭線
  ctx.beginPath();
  PREFECTURE_RING.forEach(([lon,lat], i)=>{
    const [sx, sy] = toScreen(worldX(lon), worldY(lat));
    if(i===0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
  ctx.strokeStyle = '#274a2b';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 河川・鉄道：画面に実際に映っている範囲だけをcanvasから切り取って貼る（9引数のdrawImage）。
  // 全体を毎フレーム貼っていた以前の方式より、ズームして画面範囲が小さい時に特に軽くなる。
  const VIEWPORT_MARGIN_WORLD_PX = 120; // 画面端で地形が一瞬見切れないよう、少し広めに切り取る余白
  function drawStaticLayerCropped(sourceCanvas, originX, originY, rasterScale){
    // 現在のプレイヤー位置・ズーム倍率から、画面に映っているワールド座標の範囲を求める
    const halfWWorld = W/(2*z) + VIEWPORT_MARGIN_WORLD_PX;
    const halfHWorld = H/(2*z) + VIEWPORT_MARGIN_WORLD_PX;
    let wx0 = pWX - halfWWorld, wx1 = pWX + halfWWorld;
    let wy0 = pWY - halfHWorld, wy1 = pWY + halfHWorld;

    // ワールド座標 → このcanvas上のピクセル座標（切り取る矩形 sx,sy,sw,sh）に変換
    let sx = (wx0 - originX) * rasterScale;
    let sy = (wy0 - originY) * rasterScale;
    let sw = (wx1 - wx0) * rasterScale;
    let sh = (wy1 - wy0) * rasterScale;

    // canvasの実サイズをはみ出さないようクランプ（はみ出した分は幅・高さ側に反映する）
    if(sx < 0){ sw += sx; sx = 0; }
    if(sy < 0){ sh += sy; sy = 0; }
    if(sx + sw > sourceCanvas.width) sw = sourceCanvas.width - sx;
    if(sy + sh > sourceCanvas.height) sh = sourceCanvas.height - sy;
    if(sw <= 0 || sh <= 0) return; // 画面内にこのレイヤーが全く無い（通常は起こらない）

    // クランプ後のsx,sy,sw,shから、対応する貼り付け先（画面側）の位置・サイズを逆算する
    const cwx0 = sx / rasterScale + originX, cwx1 = (sx+sw) / rasterScale + originX;
    const cwy0 = sy / rasterScale + originY, cwy1 = (sy+sh) / rasterScale + originY;
    const dx = W/2 + (cwx0 - pWX), dy = H/2 + (cwy0 - pWY);
    const dWidth = cwx1 - cwx0, dHeight = cwy1 - cwy0;

    ctx.drawImage(sourceCanvas, sx, sy, sw, sh, dx, dy, dWidth, dHeight);
  }

  // 河川（terrain.jsで起動時に1回だけ描画したcanvasを貼るだけ。地形テクスチャの上、鉄道より下）
  // 鉄道と全く同じ仕組み・同じズーム変換ブロック内で描くので、ズームしても地形・鉄道・河川が常に一致する。
  if(riverCanvas && toggleRiver.checked){
    drawStaticLayerCropped(riverCanvas, riverCanvasOriginX, riverCanvasOriginY, RIVER_RASTER_SCALE);
  }

  // 鉄道路線（terrain.jsで起動時に1回だけ描画したcanvasを貼るだけ。地形テクスチャの上、宝箱・県庁・探検家より下）
  if(railCanvas && toggleRail.checked){
    drawStaticLayerCropped(railCanvas, railCanvasOriginX, railCanvasOriginY, RAIL_RASTER_SCALE);
  }

  // 宝箱
  const now = performance.now();
  state.chests.forEach(c=>{
    if(c.state === 'gone') return;
    const [sx, sy] = toScreen(worldX(c.lon), worldY(c.lat));
    if(sx < -60 || sx > W+60 || sy < -60 || sy > H+60) return;
    if(c.state === 'closed'){
      // 表示サイズのみ1.5倍相当に拡大（当たり判定のCHEST_SIZE_PXは変更しない）
      drawSpriteOrFallback(IMG_CHEST_CLOSED, sx, sy + CHEST_SIZE_PX/2, CONFIG.CHEST_SIZE, ()=>{
        ctx.fillStyle = '#5ecb63';
        ctx.fillRect(sx - CHEST_SIZE_PX/2, sy - CHEST_SIZE_PX/2, CHEST_SIZE_PX, CHEST_SIZE_PX);
        ctx.strokeStyle = '#3a8a3f'; ctx.lineWidth = 3;
        ctx.strokeRect(sx - CHEST_SIZE_PX/2, sy - CHEST_SIZE_PX/2, CHEST_SIZE_PX, CHEST_SIZE_PX);
      });
    } else { // opening：経過時間からスプライトシートのコマを算出して再生
      const frameIdx = Math.floor((now - c.openStart) / CHEST_OPEN_FRAME_MS);
      drawSheetFrameOrFallback(SHEET_CHEST_OPENING, frameIdx, sx, sy + CHEST_SIZE_PX/2, CONFIG.CHEST_SIZE*1.15, ()=>{
        ctx.fillStyle = '#ffd93d';
        ctx.fillRect(sx - CHEST_SIZE_PX/2, sy - CHEST_SIZE_PX/2, CHEST_SIZE_PX, CHEST_SIZE_PX);
        ctx.strokeStyle = '#b89400'; ctx.lineWidth = 3;
        ctx.strokeRect(sx - CHEST_SIZE_PX/2, sy - CHEST_SIZE_PX/2, CHEST_SIZE_PX, CHEST_SIZE_PX);
      });
    }
  });

  // ヒント掲示板（宝箱と県庁の間の重ね順）
  drawHintBoards(toScreen);

  // 県庁（③ 霧が晴れていない場所ではこの後の霧オーバーレイで自然に隠れる）
  {
    const [sx, sy] = toScreen(worldX(state.boss.lon), worldY(state.boss.lat));
    // 表示サイズのみ1.5倍相当に拡大（当たり判定のBOSS_SIZE_PXは変更しない）
    drawSpriteOrFallback(IMG_CAPITAL, sx, sy + BOSS_SIZE_PX/2, CONFIG.CAPITAL_SIZE, ()=>{
      ctx.fillStyle = '#ff5a5a';
      ctx.fillRect(sx - state.boss.sizePx/2, sy - state.boss.sizePx/2, state.boss.sizePx, state.boss.sizePx);
      ctx.strokeStyle = '#a83030'; ctx.lineWidth = 3;
      ctx.strokeRect(sx - state.boss.sizePx/2, sy - state.boss.sizePx/2, state.boss.sizePx, state.boss.sizePx);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('県庁', sx, sy+4);
    });
  }

  // 探検家（常に画面中央）：スプライトシートのコマを移動中だけ進める。実アルファなのでCanvas描画でOK
  drawSheetFrameOrFallback(playerAnimSheet, playerAnimFrame, W/2, H/2 + PLAYER_R_PX + (playerAnimSheet.adjust ? playerAnimSheet.adjust.yOffset : 0), CONFIG.PLAYER_SIZE * (playerAnimSheet.adjust ? playerAnimSheet.adjust.scale : 1), ()=>{
    ctx.fillStyle = '#ffd93d';
    ctx.beginPath(); ctx.arc(W/2, H/2, PLAYER_R_PX, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#b89400'; ctx.lineWidth = 3; ctx.stroke();
  });
  ctx.restore(); // カメラズームここまで

  // ② Fog of War オーバーレイ（探索済み以外を覆う。これが③の県庁非表示も兼ねる）
  fogCtx.clearRect(0,0,W,H);
  fogCtx.fillStyle = 'rgba(4,8,14,0.93)';
  fogCtx.fillRect(0,0,W,H);
  fogCtx.globalCompositeOperation = 'destination-out';
  const sx = (pWX - W/(2*z) - worldMinX) * FOG_RES_SCALE;
  const sy = (pWY - H/(2*z) - worldMinY) * FOG_RES_SCALE;
  const sw = (W/z) * FOG_RES_SCALE, sh = (H/z) * FOG_RES_SCALE;
  fogCtx.drawImage(maskCanvas, sx, sy, sw, sh, 0, 0, W, H);
  fogCtx.globalCompositeOperation = 'source-over';
  ctx.drawImage(fogCanvas, 0, 0);

  // ④ ミニマップ（探索済みシルエットのみ、地名なし）
  drawMinimap(pWX, pWY);
}

// ミニマップ用の使い回しキャンバス（霧オーバーレイの合成用）。サイズはワールド比で固定なので一度だけ作る。
// ==== ゲームループ（デルタタイム方式） ====
// rAFのタイムスタンプ差から dt を求める。最初のフレームは 1/60 秒。上限は CONFIG.DT_MAX_SEC。
// タブが非表示→表示に戻った時は前フレームのタイムスタンプを捨てる（戻った最初のフレームは 1/60 秒）。
// 残り時間タイマーだけは従来どおり実時間（rawMs＝lastTime との差、頭打ちなし）で減らす。
let lastFrameTime = null;
document.addEventListener('visibilitychange', ()=>{ lastFrameTime = null; });
function loop(now){
  const rawMs = now - lastTime; lastTime = now;               // タイマー用の実経過時間（従来どおり）
  let dtSec = (lastFrameTime === null) ? 1/60 : (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  if(dtSec < 0) dtSec = 0;
  const rawDtSec = dtSec;
  dtSec = Math.min(dtSec, CONFIG.DT_MAX_SEC);
  update(dtSec, rawMs); draw();
  if(CONFIG.DEBUG) updateDebugHud(dtSec, rawDtSec);
  requestAnimationFrame(loop);
}

// 開発確認用：画面の隅に dt(ms) と FPS（直近の平均）を出す。CONFIG.DEBUG（または ?debug=1）の時だけ作られる。通常は何も出ない。
let debugHudEl = null, debugAccumSec = 0, debugFrames = 0, debugText = '';
function updateDebugHud(dtSec, rawDtSec){
  if(!debugHudEl){
    debugHudEl = document.createElement('div');
    debugHudEl.id = 'debugHud';
    debugHudEl.style.cssText = 'position:absolute;left:4px;bottom:3px;z-index:40;pointer-events:none;font:10px/1.3 monospace;color:#9fffd0;background:rgba(0,0,0,0.55);padding:1px 5px;border-radius:3px;';
    wrap.appendChild(debugHudEl);
  }
  debugAccumSec += rawDtSec; debugFrames++;
  if(debugAccumSec >= 0.5){ // 0.5秒ごとに平均して表示（数字がチラつかないように）
    const avgDt = debugAccumSec / debugFrames;
    debugText = 'dt ' + (avgDt * 1000).toFixed(1) + 'ms  ' + (1 / avgDt).toFixed(0) + 'fps  x' + (avgDt * 60).toFixed(2);
    debugAccumSec = 0; debugFrames = 0;
  }
  debugHudEl.textContent = debugText || 'dt ...';
}

// ==== クイズ ====
function endGame(won){
  state.mode = won ? 'clear' : 'gameover';
  updateHintButtonVisibility(); // ui.js：フィールドで遊んでいる間（playing）だけヒントボタンを表示
  if(won) clearOverlay.classList.add('show'); else gameOverOverlay.classList.add('show');
}

window.resetGame = function(){ initGame(); };

// ==== 県ナレッジ（data/pref<XX>/knowledge_<XX>.js の KNOWLEDGE_<XX>） ====
// ボス戦クイズとヒント掲示板の元データ。1問 = { id, question, options(4つ), answer("0"〜"3"), hint }。
// answer は次の2形式のどちらでも受け付ける（どちらも最終的に「正解の選択肢の文字列」に変換して判定する）：
//   ・"0"〜"3"：正解の選択肢のインデックス（文字列）
//   ・正解の選択肢そのものの文字列（options のどれかと完全一致）。添付の knowledge_13.js はこの形式（全問、先頭の選択肢が正解）
// いずれも正解が先頭に固定されたデータなので、出題時に必ず選択肢をシャッフルし、正誤は「正解の選択肢の文字列」で判定する（ui.js）。
let currentKnowledge = []; // 検証を通った問題だけが入る（loadPrefectureData()完了時に setCurrentKnowledge() が設定）
function knowledgeProblem(q, seenIds){
  if(!q || typeof q !== 'object') return '問題オブジェクトではない';
  if(typeof q.id !== 'string' || !q.id) return 'idがない';
  if(seenIds.has(q.id)) return 'idが重複している';
  if(typeof q.question !== 'string' || !q.question) return 'questionがない';
  if(typeof q.hint !== 'string' || !q.hint) return 'hintがない';
  if(!Array.isArray(q.options) || q.options.length !== 4) return 'optionsが4つではない';
  if(!q.options.every(o => typeof o === 'string' && o)) return 'optionsに空または文字列でない要素がある';
  if(new Set(q.options).size !== q.options.length) return 'optionsに重複がある';
  if(typeof q.answer !== 'string' || (!['0','1','2','3'].includes(q.answer) && !q.options.includes(q.answer))){
    return 'answerが"0"〜"3"でも、optionsのどれかと一致する文字列でもない';
  }
  return null;
}
// 検証済みの問題から「正解の選択肢の文字列」を取り出す（answerが"0"〜"3"ならそのインデックスの選択肢、それ以外はanswer自体）
function knowledgeCorrectText(q){
  return ['0','1','2','3'].includes(q.answer) ? q.options[Number(q.answer)] : q.answer;
}
// 各問を検証し、問題のあるものは console.warn を出してその問題だけスキップする（ゲーム全体は止めない）
function validateKnowledge(raw, xx){
  const valid = [], seenIds = new Set();
  if(!Array.isArray(raw)) return valid;
  raw.forEach((q, i)=>{
    const reason = knowledgeProblem(q, seenIds);
    if(reason){
      console.warn('[knowledge] KNOWLEDGE_' + xx + '[' + i + ']' + (q && q.id ? '(id=' + q.id + ')' : '') + ' をスキップ: ' + reason);
      return;
    }
    seenIds.add(q.id);
    valid.push(q);
  });
  return valid;
}
// 検証済みの問題を currentKnowledge に格納し、有効な問題数を返す
function setCurrentKnowledge(prefCode, raw){
  const xx = String(prefCode).padStart(2, '0');
  currentKnowledge = validateKnowledge(raw, xx);
  return currentKnowledge.length;
}

// ==== 県の決定 ====
// 優先順位：① URLパラメータ ?pref=NN（例 ?pref=13 / ?pref=01）② CONFIG.FORCE_PREFECTURE_CODE
//          ③ data/available_prefs.js の AVAILABLE_PREFECTURE_CODES からランダムに1つ
// ①②は、一覧に含まれ、かつ excluded（今回すでに読み込みに失敗した県）に入っていない場合だけ採用する。
// 採用できない場合は console.warn を出して次の優先順位へ。候補が1つも無ければ null を返す。
function pickPrefectureCode(excluded){
  excluded = excluded || [];
  const all = (typeof AVAILABLE_PREFECTURE_CODES !== 'undefined' && Array.isArray(AVAILABLE_PREFECTURE_CODES))
    ? AVAILABLE_PREFECTURE_CODES.filter(c => Number.isInteger(c)) : [];
  const candidates = all.filter(c => !excluded.includes(c));
  if(candidates.length === 0) return null;

  // ① URLパラメータ
  const param = new URLSearchParams(window.location.search).get('pref');
  if(param !== null){
    const n = /^\d{1,2}$/.test(param) ? Number(param) : NaN;
    if(candidates.includes(n)) return n;
    console.warn('[pref] ?pref=' + param + ' は利用できません（一覧にない、または読み込みに失敗した県）。別の県を選びます');
  }
  // ② 開発用の固定指定
  const forced = CONFIG.FORCE_PREFECTURE_CODE;
  if(forced !== null && forced !== undefined){
    if(candidates.includes(forced)) return forced;
    console.warn('[pref] CONFIG.FORCE_PREFECTURE_CODE=' + forced + ' は利用できません（一覧にない、または読み込みに失敗した県）。別の県を選びます');
  }
  // ③ ランダム
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// 県データが読めなかった時の表示（読み込み中の画面を使う。ゲームは開始しない）
function showStartError(msg){
  const m = document.getElementById('loadingMsg');
  if(m) m.textContent = msg;
  const o = document.getElementById('loadingOverlay');
  if(o) o.classList.add('show');
}

// ==== ゲーム開始の入口：県を決める → データを動的に読み込む → 初期化してループ開始 ====
// 選んだ県の4ファイルのどれかが読み込めなかったら、その県を今回の候補から外して選び直し、4ファイルを読み直す。
// 候補が尽きたらエラーを出してゲームは開始しない。
// ※ 県データ側のglobal変数は var 宣言なので、次の県の4ファイルが全部読み込まれれば上書きされる
//   （失敗した県の途中までの変数は loadPrefectureData() の冒頭でも毎回 undefined に戻す）。
let gameStarting = false;
function startGame(){
  if(gameStarted || gameStarting) return;
  gameStarting = true;
  const failed = [];
  const attempt = ()=>{
    const code = pickPrefectureCode(failed);
    if(code === null){
      const msg = failed.length
        ? '読み込みに失敗しました：利用できる県のデータがすべて読み込めませんでした'
        : '読み込みに失敗しました：利用できる県のデータがありません（data/available_prefs.js）';
      console.error('[startGame] ' + msg);
      showStartError(msg);
      gameStarting = false;
      return;
    }
    debugLog('[startGame] 試行する県コード:', code, '（失敗済み:', failed.join(',') || 'なし', '）');
    loadPrefectureData(code).then(
      ()=>{ initPrefectureGame(); },                 // 成功：ワールド構築〜ループ開始
      (err)=>{                                       // 失敗：その県を外して選び直す
        console.error(err);
        failed.push(code);
        attempt();
      }
    );
  };
  attempt();
}

// ==== 県データの読み込み完了後の初期化（startGame から1回だけ呼ばれる） ====
// 県データ（PREFECTURE_RING・MESH_RUNS_FLAT・RAIL_ROUTES・riverData 等）が必要な「1回だけの重い初期化」をここに集約。
// resetGame()（もう一度プレイ）が呼ぶ initGame() は、ラン単位の状態（位置・宝箱・霧・タイマー）の初期化だけを担当し、
// 地形ラスター等は作り直さない。
let gameStarted = false;
function initPrefectureGame(){
  if(gameStarted) return;
  gameStarted = true;
  setupWorldCoordinates(); // ワールド座標系（県データのポリゴンから決まる）
  initTerrain();           // terrain.js：メッシュ展開・地形ラスター・テクスチャ読み込み・鉄道/河川canvas
  initMinimap();           // ui.js：ミニマップ用canvas
  initGame();              // ラン単位の初期化（スポーン・宝箱・霧・タイマー）
  const loadingOverlay = document.getElementById('loadingOverlay');
  if(loadingOverlay) loadingOverlay.classList.remove('show');
  requestAnimationFrame(loop);
}
