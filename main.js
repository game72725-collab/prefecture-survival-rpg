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
  DEBUG_PROF_SYNC: false,      // true にすると、DEBUG時のフレーム内訳の計測で、各区間の終わりに描画を確定させる（内訳が正確になる代わりに少し遅い）
  DEBUG: false,                // true の時だけ、開発確認用の console.log と、画面隅の dt(ms)・FPS 表示を出す。URLに ?debug=1 を付けても true になる（県コードなどは画面には一切出さない）
  DT_MAX_SEC: 0.05,            // 1フレームのdt（秒）の上限。タブ復帰や重い処理の直後に、大きな値で一気に動かないようにする（0.05秒＝20fps相当）
  MAX_STEP_PX: 8,              // 移動の1サブステップの最大量(px)。1フレームの移動量がこれを超える時は等分して、各サブステップで通行判定・県境判定をやり直す（すり抜け防止）
  // ---- 地形タイル（terrain.js） ----
  TILE_WORLD_PX: 200,          // タイルの大きさ（ワールドpx）。5の倍数にすること（単色タイルの解像度0.4倍で整数pxになるため）
  TILE_PREFETCH: 2,            // 画面に映るタイルの周囲、何タイル先までテクスチャタイルを先読みして焼くか
  TILE_BAKES_PER_FRAME: 2,     // 1フレームに焼くテクスチャタイルの最大枚数
  TILE_BAKE_BUDGET_MS: 4,      // 1フレームのbakeの合計時間の目安（超えたらそのフレームはそこまで。ただし画面内に未生成があれば最低1枚は焼く）
  TILE_CACHE_MAX_TEXTURED: 160, // テクスチャタイルのキャッシュ上限（枚）。超えたら最終使用が古いものから捨ててプールへ
  TILE_CACHE_MAX_SOLID: 400,   // 単色タイルのキャッシュ上限（枚）
  TILE_CACHE_MAX_RAIL: 300,    // 鉄道タイルのキャッシュ上限（枚。線が1本も触れない空タイルは数えない）
  TILE_CACHE_MAX_RIVER: 300,   // 河川タイルのキャッシュ上限（枚。同上）
  // ---- 霧（Fog of War）のタイル（main.js） ----
  FOG_TILE_WORLD_PX: 1000,     // 霧タイルの大きさ（ワールドpx）。地形タイルの整数倍にすること（同じ格子に揃う）。解像度は FOG_RES_SCALE(0.2倍)なので1枚は 200×200 canvas px（＋余白）
  FOG_TILE_MAX: 300,           // 霧タイルの安全上限（枚。1枚約0.16MB＝約48MB）。探索済みの情報なのでLRUでは捨てない。上限に達したら新しいタイルは作らず、警告を1回だけ出す
  TILE_START_WAIT_MS: 5000,    // ゲーム開始前にテクスチャの読み込みを待つ最大時間。超えたら単色タイルのまま開始する
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
  // 宝箱の中身の抽選の重み（合計に対する割合で出る）。上限（ITEM_MAX_PER_RUN）に達した種類は抽選から外れる（items.js の pickChestItem）
  CHEST_ITEM_WEIGHTS: { time: 35, speed: 25, fifty: 25, compass: 15, glider: 10, car: 8, map: 6 }, // time=⏱+秒（県の規模でスケール） / speed=👟スピードアップ / fifty=✂️50-50 / compass=🧭県庁サーチ / glider=🪂減速無効 / car=🚗スピード上位版 / map=🗺宝箱地図
  // 新アイテムの重み（glider 10・car 8）：既存で最も低い compass(15) より低くして「希少」にする（県の条件を満たす県でだけ抽選に入るので、合計に占める割合はさらに小さい）
  // 宝箱地図の重み(map 6)：既存で最も低い car(8) よりさらに低くして「最も希少」にする（取得すると近くの宝箱を含む広い範囲の霧が晴れ、強いため）
  // 宝箱地図：未取得の宝箱（プレイヤーに最も近い1つ）を必ず含む円の霧を、中心をずらして晴らす。晴らした円は霧タイル・ミニマップのマスクに書き込まれ、そのまま残る
  MAP_REVEAL_BASE_KM: 3,     // 宝箱地図で晴らす円の半径(km、scale=1のとき)。実際は ×scale（③の式）。【仮置き】通常の視界半径(約2.6km)より少し大きく、scale倍(1〜3)で最大9km
  MAP_OFFSET_RANGE: [0.25, 0.6], // 円の中心を宝箱からずらす量（半径に対する割合の [最小, 最大]、向きはランダム）。根拠：宝箱が中心にならない（≥25%）、かつ円の内側に余裕を持って入る（≤60%＜解除グラデーション開始の75%）
  // 県の条件で抽選に入るか：glider＝森林率+河川率 ≥ GLIDER_MIN_FOREST_RATIO、car＝陸地面積 ≥ CAR_MIN_AREA_KM2（満たさない県では抽選候補から外す。items.js の itemAvailable）
  GLIDER_BASE_SEC: 10,       // グライダーの効果時間（秒、scale=1のとき）。根拠：スピード(BIKE_DURATION_SEC=10)と同じ長さで、scale倍の式も同じ（speedBoostSecFor と同様）
  GLIDER_MIN_FOREST_RATIO: 0.4, // グライダーが抽選に入る県の下限（森林率+河川率）。【仮置き】減速（森林・河川）の多い県でだけ役に立つ。実際の値は ?debug=params の表で見て決める
  CAR_SPEED_MUL: 2.4,        // 車の速度倍率（地形の倍率に掛け算）。根拠：スピード(SPEED_BIKE_MULT=1.7)の上位版として、約1.4倍速い
  CAR_BASE_SEC: 10,          // 車の効果時間（秒、scale=1のとき）。根拠：スピードと同じ長さ（scale倍の式も同じ）
  CAR_MIN_AREA_KM2: 5000,    // 車が抽選に入る県の下限（陸地面積km²）。【仮置き】狭い県では、速すぎて県の端まで一気に着いてしまうため
  ASSET_GLIDER: 'assets/glider.png', ASSET_CAR: 'assets/car.png', // 画像のファイル名のみ（画像は未作成。使う時に loadImg で読み込む。今は読み込まない＝404を出さない）
  AUTO_PAUSE: true,          // 画面が見えなくなった時（visibilitychange=hidden）・ウィンドウが blur した時に自動でポーズする（自動再開はしない。再開ボタンで戻る）。指定どおり
  DEBUG_LOOT_PREFS: [1, 13], // ?debug=loot でシミュレーションする県のコード。根拠：北海道（広い）と東京（狭い）の両方で、県の条件による違いを見る
  // 1プレイ（1ラン）内の取得上限。宝箱の中身を決めるたびに、上限に達した種類を抽選候補から外し、残りの重み(CHEST_ITEM_WEIGHTS)で再正規化して抽選する（time・speed は上限なし）
  ITEM_MAX_PER_RUN: { fifty: 3, compass: 1, glider: 2, car: 2, map: 2 }, // fifty=3：ボス戦は2問なので「2問＋1の余裕」／compass=1：県庁サーチは1回発動すれば足りる／glider=2・car=2：効果時間が短い（10秒×scale）ので、2回までなら溜まりすぎず、希少さも保てる／map=2：1回で広い範囲が晴れるので、2回までで探索の面白さを残す
  DEBUG_FORCE_ITEM: null,    // 'speed' / 'time' / 'fifty' / 'compass' / 'glider' / 'car' / 'map' のどれかにすると全宝箱がそのアイテムになる。null で通常（重み抽選）
  // ---- ヒント掲示板 ----
  HINT_BOARD_SIZE: 60,       // 掲示板の表示高さ(px)
  // ---- 難易度・スポーン・配置（県の大きさ R＝県庁から県境までの最大距離 に対する割合と、難易度で決める） ----
  // 難易度は URL の ?diff=easy|normal|hard|veryhard が優先（大文字小文字は区別しない。不正な値は無視して下の値を使う）。選択画面は無い。
  DIFFICULTY_DEFAULT: 'NORMAL',
  DIFFICULTY: {
    // spawnPct      : スポーンの距離（県庁から）を R に対する割合で [最小, 最大]
    // spawnMaxKm    : スポーン距離の上限(km)。宝箱数・アイテム効果の「県の規模」の基準にもなる（下の KM_PER_CHEST・ITEM_REF_KM）
    // chestCountMul : 宝箱数の難易度別の倍率（宝箱数 = round(spawnMaxKm / KM_PER_CHEST) × この倍率 × ランダム幅。computeChestCount）
    // chestCount    : 【旧・現在は使わない】固定の宝箱数。互換と参考のために残してある（宝箱数は上の式で決まる）
    // timeSec       : 【廃止】制限時間は全難易度・全県共通の CONFIG.TIME_LIMIT_SEC（ここには持たない）
    EASY:     { spawnPct: [0.10, 0.25], spawnMaxKm: 40,  chestCountMul: 2.30, chestCount: 14 }, // 2.30：基準数10×2.30＝23個。難易度間の比率（約1.3:1:0.57:0.31）は旧 chestCount(14:10:6:3) に近い
    NORMAL:   { spawnPct: [0.25, 0.45], spawnMaxKm: 70,  chestCountMul: 1.00, chestCount: 10 }, // 1.00：基準数18×1.00＝18個（NORMAL を基準の1.00にした）
    HARD:     { spawnPct: [0.45, 0.70], spawnMaxKm: 95,  chestCountMul: 0.43, chestCount: 6  }, // 0.43：基準数24×0.43≒10個（NORMAL比0.57＝旧の 6÷10 に近い）
    VERYHARD: { spawnPct: [0.70, 0.95], spawnMaxKm: 115, chestCountMul: 0.19, chestCount: 3  }, // 0.19：基準数29×0.19≒5.5個（NORMAL比0.31＝旧の 3÷10 に近い）
  },
  TIME_LIMIT_SEC: 300,       // 制限時間(秒)。全難易度・全県共通（ここ1か所を変えれば全体が変わる）。根拠：県の規模が広い（スポーン最大115km）ので、旧120秒では届かないため、約2.5倍に
  // ---- 宝箱数（難易度の spawnMaxKm に比例。computeChestCount） ----
  KM_PER_CHEST: 4,           // 宝箱1個あたりの km。基準数＝round(spawnMaxKm÷4)。【仮置き】7→4：宝箱を増やすため。基準数は EASY10／NORMAL18／HARD24／VERYHARD29（?debug=params の表で確認）
  CHEST_RANDOM_RANGE: 0.25,  // 宝箱数のランダム幅（±25%。gameRandom で一様）。根拠：ランごとに数が少し変わる程度（指定値）
  CHEST_MIN: 2,              // 宝箱数の下限。根拠：最少の VERYHARD(現在約5〜6個)が大きく減っても、0〜1個にならない最小限の安全値
  CHEST_MAX: 40,             // 宝箱数の上限。【仮置き】20→40：現在の最多（EASY 公称23の+25%≒29）に余裕を持たせ、倍率や KM_PER_CHEST を調整しても置ききれないほど増えないようにする
  // ---- 時間アイテム・スピードアイテムの県の規模スケール ----
  // scale = clamp(spawnMaxKm ÷ ITEM_REF_KM, 1, ITEM_SCALE_MAX)。時間アイテム＝TIME_ITEM_BASE_SEC×scale 秒（整数）、スピード＝効果時間のみ BIKE_DURATION_SEC×scale 秒（倍率 SPEED_BIKE_MULT は据え置き）
  ITEM_REF_KM: 40,           // scale=1 になる spawnMaxKm。根拠：最も狭い EASY(40km)で従来どおり（+10秒・10秒）
  ITEM_SCALE_MAX: 3,         // scale の上限。根拠：VERYHARD(115÷40≒2.9)はほぼそのまま通し、将来 spawnMaxKm を大きくしても極端に伸びないようにする
  TIME_ITEM_BASE_SEC: 10,    // 時間アイテムの基本秒数（scale=1 のとき）。根拠：従来の「残り時間 +10秒」

  SPAWN_MIN_KM: 5,           // スポーン距離の下限(km)
  SPAWN_TRIES: 500,          // スポーン抽選の試行回数（範囲を広げる段階ごと）
  HINT_BOARD_COUNT: 20,      // ヒント掲示板の数（県全体に配置。有効な問題がこれより少ない時は問題数まで）
  // 宝箱・掲示板の散らし方。URL の ?scatter=prefecture|reachable が優先（大文字小文字は区別しない）
  ITEM_SCATTER_MODE: 'reachable', // 'prefecture'＝県全体（A）／'reachable'＝スポーンから届く範囲（B。既定）。?scatter= で切替可。根拠：宝箱が増えるので、スポーンから届く範囲に集めて取りやすくする
  ITEM_REACH_FACTOR: 1.3,    // B の半径＝その難易度の spawnMaxKm × この値(km)
  PLACE_MIN_SEP_KM: 0.8,     // 宝箱・掲示板どうしの最小間隔(km)。置けない時は 0.8倍ずつ（最大5回）緩める
  PLACE_MIN_FROM_SPAWN_KM: 0.3, PLACE_MIN_FROM_CAPITAL_KM: 0.5, // スポーン・県庁からの最小距離(km)
  PLACE_TRIES: 300,          // 1点あたりの試行回数（間隔を緩める段階ごと）
  // ---- 難易度の選択画面 ----
  SHOW_DIFFICULTY_SELECT: true, // false なら、起動時・再プレイ時の選択画面を出さず、?diff= または DIFFICULTY_DEFAULT で開始する（URL に ?diff= がある時も出さない）
  // ---- デイリーチャレンジ（?daily=1／タイトル画面のボタン。?pref=・?diff=・?scatter= と一緒でも ?daily=1 が優先） ----
  DAILY_TZ_OFFSET_HOURS: 9,  // 日付は日本時間(JST=UTC+9)。端末のタイムゾーン設定に依存しない（UTC時刻にこの時間を足して日付を出す）。根拠：全員が同じ日に同じ盤面を遊べるように
  DAILY_SALT: 'daily-v1',    // 日付から seed・県・難易度を作るハッシュの塩。根拠：盤面の生成方法を変えた時にこの値を変えると、全員が新しい盤面になる（古い記録は日付ごとなので残る）
  DAILY_STORAGE_PREFIX: 'prefSurvival.daily.', // 日付ごとの結果（クリア可否・残り秒数）の localStorage キーの接頭辞（使えなくても動く）
  DIFFICULTY_STORAGE_KEY: 'prefSurvival.lastDifficulty', // 前回選んだ難易度の保存先（localStorage。使えなくても動く）
  DIFFICULTY_UI: {           // 選択画面のひと言（数値は出さない）
    EASY:     '県庁が近い・宝箱が多い',
    NORMAL:   'ふつう',
    HARD:     '県庁が遠い・宝箱が少ない',
    VERYHARD: '県庁がかなり遠い・宝箱がごくわずか',
  },
  // ---- 宝箱・掲示板の目印（上方に浮かぶ▼／◆。中身では変えない。霧の下では見えない） ----
  SHOW_ITEM_MARKERS: true,   // false で目印を表示しない
  MARKER_SIZE_PX: 20,        // 目印の大きさ（画面px。ズームで変えない）
  MARKER_GAP_PX: 6,          // スプライトの上端から、目印の先端までの距離（画面px）
  MARKER_BOB_PX: 3,          // 上下の揺れの振幅（画面px）
  MARKER_BOB_PERIOD_MS: 1200, // 揺れの周期（ミリ秒。実時間 performance.now で決めるので、60Hzでも120Hzでも同じ速さ）
  MARKER_CHEST_COLOR: '#FFC400', // 宝箱：下向き三角▼
  MARKER_BOARD_COLOR: '#FF2D95', // 掲示板：ひし形◆（形が違うので、色が無くても区別できる）
  MARKER_OUTLINE_WHITE_PX: 2, MARKER_OUTLINE_BLACK_PX: 1, // 縁取り：白(内側)の外側に黒
  MARKER_MARGIN_PX: 40,      // 目印は、その位置（ワールド座標を画面に写した点）が「画面＋この余白」の範囲に入ったら表示する。根拠：端でぱっと出入りしないよう、スプライトの幅の半分ほどの余白
  MARKER_ONLY_EXPLORED: false, // true にすると、霧が完全に晴れた場所でだけ目印を描く（霧の透過7%で未探索の位置が分かるのを防ぐ。探索済みの記録 isExploredAt を使う）。既定 false：根拠＝指定は「画面内に入ったら表示」。通常の画面内は探索済みなので差はほぼ出ない
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
  // ---- ミニマップ（県の大きさ・縦横比によらない固定の正方形） ----
  MINIMAP_SIZE: 92,             // ミニマップの一辺(px)。県の外接矩形を、縦横比を保ってこの正方形に収め、中央に置く
  MINIMAP_REVEAL_MIN_PX: 3,     // ミニマップ上の探索の跡の最小半径(px)。大きな県で実際の縮尺の半径が小さくなりすぎても、跡が見えるようにする
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

// ==== 乱数（ゲームの抽選はすべてここを通す。既定は Math.random。検証用に setGameRandom(シード付き関数) で差し替えられる） ====
let gameRandom = () => Math.random();
function setGameRandom(fn){ gameRandom = (typeof fn === 'function') ? fn : (() => Math.random()); }

// ==== デイリーチャレンジ：日付（JST）→ seed・県・難易度。同じ日は、誰がやっても同じ盤面になる ====
// 盤面の生成（スポーン・掲示板・宝箱の位置・宝箱の数と中身・クイズ）は、日付から作る「生成用のストリーム」だけで行い、プレイ中の抽選（gameRandom）とは別にする。
// 生成用は用途ごとに独立したストリーム（spawn／place／loot／quiz）にしてあるので、ある用途の乱数の消費量（例：配置のやり直し回数）が他に影響しない。
// プレイ用（play）は、プレイヤーの行動で消費量が変わるが、盤面（生成）には影響しない。
function hash32(str){ // FNV-1a（32bit）。環境によらず同じ値になる
  let h = 0x811c9dc5;
  for(let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function mulberry32(seed){ // seed 付きの乱数（0以上1未満）
  let a = seed >>> 0;
  return function(){ a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// 日本時間の日付 YYYYMMDD（整数）。UTC の時刻に +9時間してから、UTC の年月日として読む（端末のタイムゾーンを使わない）
function jstDateInt(nowMs){
  const d = new Date(nowMs + CONFIG.DAILY_TZ_OFFSET_HOURS * 3600 * 1000);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}
function dateLabel(date){ const s = String(date); return s.slice(0, 4) + '/' + s.slice(4, 6) + '/' + s.slice(6, 8); }
// ?date=YYYYMMDD（検証用）：?debug が付いている時だけ有効。無効・不正な値は無視して今日（JST）
function dailyDateFromUrl(params){
  const d = params.get('date');
  if(d !== null && params.has('debug') && /^\d{8}$/.test(d)){
    const y = Number(d.slice(0, 4)), mo = Number(d.slice(4, 6)), da = Number(d.slice(6, 8));
    if(y >= 2000 && mo >= 1 && mo <= 12 && da >= 1 && da <= 31) return Number(d);
  }
  return jstDateInt(Date.now());
}
// その日の盤面の元：県（利用可能な県のコード順リストから、日付のハッシュで選ぶ）・難易度（日付のハッシュで選ぶ）
function computeDailyPlan(date, availableCodes){
  const codes = (availableCodes || []).filter(c => Number.isInteger(c)).sort((a, b) => a - b);
  const keys = Object.keys(CONFIG.DIFFICULTY);
  const base = CONFIG.DAILY_SALT + ':' + date + ':';
  return { date: date, pref: codes.length ? codes[hash32(base + 'pref') % codes.length] : null, codes: codes,
           diffKey: keys[hash32(base + 'diff') % keys.length] };
}
function dailyStream(plan, name){ return mulberry32(hash32(CONFIG.DAILY_SALT + ':' + plan.date + ':' + name)); } // 用途ごとの独立したストリーム
function dailyAvailableCodes(){ return (typeof AVAILABLE_PREFECTURE_CODES !== 'undefined' && Array.isArray(AVAILABLE_PREFECTURE_CODES)) ? AVAILABLE_PREFECTURE_CODES : []; }
const dailyParams = new URLSearchParams(window.location.search);
// ?daily=1 のとき、その日の盤面の元（なければ null＝通常プレイ）。起動中は固定（日付をまたいで遊んでも、起動した日の盤面）
const dailyPlan = (dailyParams.get('daily') === '1') ? computeDailyPlan(dailyDateFromUrl(dailyParams), dailyAvailableCodes()) : null;

// ---- 日付ごとの結果（localStorage。使えなくても動く＝そのページを開いている間だけメモリに持つ） ----
const dailyMemRecords = {};
function loadDailyRecord(date){
  try{
    const v = window.localStorage.getItem(CONFIG.DAILY_STORAGE_PREFIX + date);
    if(v){ const r = JSON.parse(v); if(r && r.best && typeof r.best.clear === 'boolean') return r; }
  }catch(e){ /* 使えない・壊れた値は無視 */ }
  return dailyMemRecords[date] || null;
}
function saveDailyRecord(date, rec){
  dailyMemRecords[date] = rec;
  try{ window.localStorage.setItem(CONFIG.DAILY_STORAGE_PREFIX + date, JSON.stringify(rec)); }catch(e){ /* 保存できなくても続行 */ }
}
// 今日のベスト：クリアした方が上。クリア同士なら残り秒数が大きい方が上。何度でも再挑戦できる
function recordDailyResult(date, clear, remainSec){
  const prev = loadDailyRecord(date);
  const cur = { clear: !!clear, remain: clear ? Math.max(0, Math.round(remainSec)) : 0 };
  const better = !prev || (cur.clear && !prev.best.clear) || (cur.clear && prev.best.clear && cur.remain > prev.best.remain);
  const rec = { best: better ? cur : prev.best, last: cur, tries: (prev ? prev.tries : 0) + 1 };
  saveDailyRecord(date, rec);
  return rec;
}
function dailyBestText(rec){
  if(!rec) return '今日はまだ挑戦していません';
  return '今日のベスト：' + (rec.best.clear ? 'クリア　残り ' + rec.best.remain + '秒' : '未クリア') + '（' + rec.tries + '回挑戦）';
}

// ==== 難易度と配置モードの決定（優先順位：URLパラメータ → CONFIG。不正な値は無視して console.warn） ====
//   ?diff=easy|normal|hard|veryhard、?scatter=prefecture|reachable（大文字小文字は区別しない）。画面には出さない。
function resolveGameSettings(search){
  if(dailyPlan){ // デイリー：難易度は日付で決まり、配置モードは CONFIG の値に固定（?diff=・?scatter= は無視。全員が同じ盤面になるように）
    const m = String(CONFIG.ITEM_SCATTER_MODE).toLowerCase();
    return { difficultyKey: dailyPlan.diffKey, difficulty: CONFIG.DIFFICULTY[dailyPlan.diffKey], scatterMode: (m === 'prefecture' || m === 'reachable') ? m : 'reachable' };
  }
  const params = new URLSearchParams(search || '');
  const diffs = CONFIG.DIFFICULTY;
  let key = String(CONFIG.DIFFICULTY_DEFAULT).toUpperCase();
  if(!diffs[key]){
    const fallback = diffs.NORMAL ? 'NORMAL' : Object.keys(diffs)[0];
    console.warn('[settings] CONFIG.DIFFICULTY_DEFAULT=' + CONFIG.DIFFICULTY_DEFAULT + ' は定義にありません。' + fallback + ' を使います');
    key = fallback;
  }
  const pd = params.get('diff');
  if(pd !== null){
    if(diffs[pd.toUpperCase()]) key = pd.toUpperCase();
    else console.warn('[settings] ?diff=' + pd + ' は無視します（easy / normal / hard / veryhard のどれか）。' + key + ' を使います');
  }
  const modes = ['prefecture', 'reachable'];
  let mode = String(CONFIG.ITEM_SCATTER_MODE).toLowerCase();
  if(!modes.includes(mode)){
    console.warn('[settings] CONFIG.ITEM_SCATTER_MODE=' + CONFIG.ITEM_SCATTER_MODE + ' は不正です。reachable を使います');
    mode = 'reachable';
  }
  const ps = params.get('scatter');
  if(ps !== null){
    if(modes.includes(ps.toLowerCase())) mode = ps.toLowerCase();
    else console.warn('[settings] ?scatter=' + ps + ' は無視します（prefecture / reachable のどちらか）。' + mode + ' を使います');
  }
  return { difficultyKey: key, difficulty: diffs[key], scatterMode: mode };
}
let gameSettings = resolveGameSettings(window.location.search);
// 難易度の選択画面を出すか：CONFIG.SHOW_DIFFICULTY_SELECT が false、または URL に ?diff= がある時（値が不正でも）は出さない
function needsDifficultySelect(search){
  if(dailyPlan) return false; // デイリーは難易度が日付で決まるので、選択画面を出さない
  if(CONFIG.SHOW_DIFFICULTY_SELECT === false) return false;
  return !new URLSearchParams(search || '').has('diff');
}
let difficultySelectEnabled = needsDifficultySelect(window.location.search);

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

  // 背景の他県ポリゴン：遊んでいる県（loadPrefectureData() で読み込んだ県コード = loadedPrefCode）と
  // 県コードが一致するリングをすべて除外してから、フラット配列を [ [ [wx,wy], ... ], ... ] のワールド座標リングに変換（一度だけ）。
  // 除外した県の島などは背景では海扱いになる（離島は不要の方針）。県コードは画面には出さない。
  const playedCode = (typeof loadedPrefCode === 'number') ? loadedPrefCode : null;
  const codesOk = (typeof OTHER_PREF_RING_CODES !== 'undefined') && OTHER_PREF_RING_CODES.length === OTHER_PREF_RINGS_FLAT.length;
  if(!codesOk) console.warn('[background] OTHER_PREF_RING_CODES がない、または OTHER_PREF_RINGS_FLAT と長さが違うため、遊んでいる県の輪郭を除外できません');
  OTHER_PREF_RINGS_WORLD = [];
  OTHER_PREF_RINGS_FLAT.forEach((flat, k)=>{
    if(codesOk && playedCode !== null && OTHER_PREF_RING_CODES[k] === playedCode) return;
    const ring = [];
    for(let i=0;i<flat.length;i+=2){ ring.push([worldX(flat[i]), worldY(flat[i+1])]); }
    OTHER_PREF_RINGS_WORLD.push(ring);
  });
  debugLog('[background] 他県リング', OTHER_PREF_RINGS_WORLD.length, '/', OTHER_PREF_RINGS_FLAT.length, '（遊んでいる県のリングを除外）');
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
const gliderHud = document.getElementById('gliderHud'), gliderBar = document.getElementById('gliderBar'), gliderSec = document.getElementById('gliderSec'), boostIcon = document.getElementById('boostIcon');
// 県の地形の統計（terrain.js の buildLanduseGrid が、地形格子の展開後に1回だけ計算する。{ forestRiverRatio, landAreaKm2, … }）。グライダー・車が抽選に入るかの判定に使う
var prefLandStats = null;

const quizOverlay = document.getElementById('quizOverlay');
const quizQuestion = document.getElementById('quizQuestion');
const quizOptions = document.getElementById('quizOptions');
const gameOverOverlay = document.getElementById('gameOverOverlay');
const clearOverlay = document.getElementById('clearOverlay');
const wrongToast = document.getElementById('wrongToast');

let W = 0, H = 0;
let fogCanvas, fogCtx;

// ==== Fog of War（探索済みの記録）：霧タイル ====
// 以前は、ワールド全体を0.2倍で覆う巨大なマスクcanvasに「晴らした場所」を白く塗っていたが、県が大きいとメモリが破綻するため、
// 「プレイヤーが探索の書き込みで触れた場所のタイルだけ」を作る方式にした。
//   タイル：ワールド座標で CONFIG.FOG_TILE_WORLD_PX（初期値1000）ごとの正方形。原点は地形タイルと同じ（県のbbox角）。
//           解像度は FOG_RES_SCALE（0.2倍。旧マスクと同じ）。1枚は 200×200 canvas px ＋ 上下左右1pxの余白（202×202）。
//   遅延確保：書き込みが触れたタイルだけ canvas を作る。触れていないタイルは canvas を持たず、「完全に未探索（霧が濃い）」として扱う。
//   破棄しない：探索済みの情報そのものなので、LRUでは捨てない。ラン開始・再プレイ・県データの読み込み直し（resetFogTiles）で全部破棄する。
//   安全上限：CONFIG.FOG_TILE_MAX。超えたら新しいタイルは作らない（既存の探索済みは保持）。
const FOG_RES_SCALE = 0.2;
const FOG_TILE_MARGIN = 1;          // タイルの上下左右の余白（canvas px）。画面へ貼る時に境界の補間が連続するように、余白にも同じ書き込みを行う
let fogTileWorldPx = 1000, fogTilePx = 200;
let fogTiles = new Map();           // key → { cv, ctx }
let fogTileWarned = false;
const fogStats = { created: 0, createMs: 0, createMaxMs: 0, revealMs: 0, reveals: 0, composeMs: 0, capped: 0 };

function resize(){
  W = wrap.clientWidth; H = wrap.clientHeight;
  canvas.width = W; canvas.height = H;
  if(fogCanvas){ fogCanvas.width = 0; fogCanvas.height = 0; } // 前の合成用canvasを確実に解放する（resizeのたびに作り直すため）
  fogCanvas = document.createElement('canvas');
  fogCanvas.width = W; fogCanvas.height = H;
  fogCtx = fogCanvas.getContext('2d');
}
window.addEventListener('resize', resize);

function fogKey(tx, ty){ return (ty + 512) * 4096 + (tx + 512); }

// 霧タイルをすべて破棄する（width/height=0 で解放）。ラン開始（initGame）・再プレイ・県データの読み込み直し（initTerrain）で呼ぶ。
// 探索状態は引き継がれない。ミニマップの霧も同時にクリアする。
// ---- 探索済みの記録（宝箱・掲示板の目印の表示用。霧タイルの描画とは独立） ----
// 目印（items.js の drawItemMarkers）は「霧が完全に晴れている場所」でだけ描く。霧の合成の前に描くだけだと、不透明度93%の霧の下でも
// 7%ぶん透けて、未探索の場所に宝箱・掲示板があることがうっすら分かってしまうため。ワールドを EXPLORED_CELL_PX ごとの格子にして、
// revealFogAt で霧を完全に晴らした範囲（解除半径の75%＝グラデーションの手前。セルの大きさぶん内側）に入ったセルを記録する。
const EXPLORED_CELL_PX = 32;
let exploredGrid = null, exploredCols = 0, exploredRows = 0;
function resetExploredGrid(){
  const cols = Math.ceil(WORLD_W / EXPLORED_CELL_PX) + 1, rows = Math.ceil(WORLD_H / EXPLORED_CELL_PX) + 1;
  if(!exploredGrid || cols !== exploredCols || rows !== exploredRows){ exploredCols = cols; exploredRows = rows; exploredGrid = new Uint8Array(cols * rows); }
  else exploredGrid.fill(0);
}
function markExploredAt(wx, wy, radiusPx){
  if(!exploredGrid || radiusPx <= 0) return;
  const C = EXPLORED_CELL_PX, r2 = radiusPx * radiusPx;
  const cx0 = Math.max(0, Math.floor((wx - radiusPx - worldMinX) / C)), cx1 = Math.min(exploredCols - 1, Math.floor((wx + radiusPx - worldMinX) / C));
  const cy0 = Math.max(0, Math.floor((wy - radiusPx - worldMinY) / C)), cy1 = Math.min(exploredRows - 1, Math.floor((wy + radiusPx - worldMinY) / C));
  for(let cy = cy0; cy <= cy1; cy++){
    const dy = worldMinY + (cy + 0.5) * C - wy;
    for(let cx = cx0; cx <= cx1; cx++){
      const dx = worldMinX + (cx + 0.5) * C - wx;
      if(dx * dx + dy * dy <= r2) exploredGrid[cy * exploredCols + cx] = 1;
    }
  }
}
function isExploredAt(wx, wy){
  if(!exploredGrid) return false;
  const cx = Math.floor((wx - worldMinX) / EXPLORED_CELL_PX), cy = Math.floor((wy - worldMinY) / EXPLORED_CELL_PX);
  if(cx < 0 || cy < 0 || cx >= exploredCols || cy >= exploredRows) return false;
  return exploredGrid[cy * exploredCols + cx] === 1;
}
function resetFogTiles(){
  for(const t of fogTiles.values()){ t.cv.width = 0; t.cv.height = 0; t.ctx = null; }
  fogTiles = new Map();
  fogTileWarned = false;
  const F = Math.round((CONFIG.FOG_TILE_WORLD_PX || 1000) / tileWorldPx) * tileWorldPx;
  fogTileWorldPx = (F >= tileWorldPx) ? F : tileWorldPx; // 地形タイルの整数倍に揃える
  fogTilePx = Math.round(fogTileWorldPx * FOG_RES_SCALE);
  for(const k of Object.keys(fogStats)) fogStats[k] = 0;
  if(typeof resetMiniFog === 'function') resetMiniFog();
  if(typeof WORLD_W === 'number' && WORLD_W > 0) resetExploredGrid(); // 目印用の探索済みの記録も、霧と一緒に初期化
}

// タイルを取得する。create=true なら、無い場合に作る（上限に達していたら null を返し、警告を1回だけ出す）。
function getFogTile(tx, ty, create){
  const key = fogKey(tx, ty);
  let t = fogTiles.get(key);
  if(t || !create) return t || null;
  if(fogTiles.size >= CONFIG.FOG_TILE_MAX){
    fogStats.capped++;
    if(!fogTileWarned){ fogTileWarned = true; console.warn('[fog] 霧タイルが上限(' + CONFIG.FOG_TILE_MAX + '枚)に達しました。新しい場所の探索は記録されません（探索済みの場所は保持されます）'); }
    return null;
  }
  const t0 = performance.now();
  const size = fogTilePx + 2 * FOG_TILE_MARGIN;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  t = { cv, ctx: cv.getContext('2d') };
  fogTiles.set(key, t);
  const ms = performance.now() - t0;
  fogStats.created++; fogStats.createMs += ms; if(ms > fogStats.createMaxMs) fogStats.createMaxMs = ms;
  return t;
}

// 現在地周辺の霧を晴らす（永続）。旧マスクと同じ描画操作（半径 FOG_REVEAL_RADIUS_BASE_PX×ZOOM_FACTOR×FOG_RES_SCALE の
// 放射グラデーションの円。中心〜75%は不透明な白、縁に向かって透明）を、円のbboxが触れるすべてのタイルに行う。
function revealFogAt(wx, wy){
  // 霧の解除半径はZOOM_FACTORに連動（ズームしても現実換算の視界範囲が変わらないようにする）
  revealFogDisc(wx, wy, CONFIG.FOG_REVEAL_RADIUS_BASE_PX * CONFIG.ZOOM_FACTOR);
}
// 中心(wx,wy)・半径 rWorld（ワールドpx）の円の霧を晴らす（霧タイルに白いグラデーションの円を書き込む＝一度晴らした場所が残る）。revealFogAt（通常の視界）と、宝箱地図（大きな円）が使う。
// 円と重なるタイルだけを更新する（新しいcanvasは作らない）。ミニマップのマスク・目印用の探索済み記録にも、同じ円を書き込む
function revealFogDisc(wx, wy, rWorld){
  const t0 = CONFIG.DEBUG ? performance.now() : 0;
  const S = FOG_RES_SCALE, F = fogTileWorldPx, M = FOG_TILE_MARGIN;
  const r = rWorld * S;
  const pad = rWorld + M / S; // 円＋タイルの余白（ワールドpx）
  const tx0 = Math.floor((wx - pad - tileOriginX) / F), tx1 = Math.floor((wx + pad - tileOriginX) / F);
  const ty0 = Math.floor((wy - pad - tileOriginY) / F), ty1 = Math.floor((wy + pad - tileOriginY) / F);
  for(let ty = ty0; ty <= ty1; ty++){
    for(let tx = tx0; tx <= tx1; tx++){
      const t = getFogTile(tx, ty, true);
      if(!t) continue;
      const mx = (wx - tileOriginX) * S - tx * fogTilePx + M, my = (wy - tileOriginY) * S - ty * fogTilePx + M; // タイル内のcanvas座標（余白ぶんを含む）
      const c2d = t.ctx;
      const grad = c2d.createRadialGradient(mx, my, 0, mx, my, r);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.75, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      c2d.fillStyle = grad;
      c2d.beginPath();
      c2d.arc(mx, my, r, 0, Math.PI*2);
      c2d.fill();
    }
  }
  markExploredAt(wx, wy, rWorld * 0.75 - EXPLORED_CELL_PX * 0.75); // 目印用：霧が完全に晴れた範囲（グラデーションの手前）を記録
  if(typeof revealMiniFog === 'function') revealMiniFog(wx, wy, rWorld); // ミニマップの霧にも、同じ書き込みを直接行う（ui.js）
  if(CONFIG.DEBUG){ fogStats.reveals++; fogStats.revealMs += performance.now() - t0; }
}

// 霧の合成用canvas（fogCtx。destination-out の状態）へ、画面に映る範囲の霧タイルを貼る。
// 貼り付け先の端は、地形・鉄道・河川のタイルと同じスナップ関数（snapTileEdge）。余白ごと拡大して、タイルの矩形でクリップする
// （destination-out は重ねるほど消えるので、クリップで隣のタイルと重ならないようにする）。
// タイルが無い範囲は何も貼らない＝霧の色のまま（旧：マスクが未探索・マスクの外と同じ見た目）。
function drawFogTiles(pWX, pWY, z){
  if(fogTiles.size === 0) return;
  const t0 = CONFIG.DEBUG ? performance.now() : 0;
  const F = fogTileWorldPx, M = FOG_TILE_MARGIN;
  const halfW = W/(2*z) + 2, halfH = H/(2*z) + 2;
  const vx0 = Math.floor((pWX - halfW - tileOriginX) / F), vx1 = Math.floor((pWX + halfW - tileOriginX) / F);
  const vy0 = Math.floor((pWY - halfH - tileOriginY) / F), vy1 = Math.floor((pWY + halfH - tileOriginY) / F);
  for(let ty = vy0; ty <= vy1; ty++){
    for(let tx = vx0; tx <= vx1; tx++){
      const t = fogTiles.get(fogKey(tx, ty));
      if(!t) continue;
      const x0 = snapTileEdge(tileOriginX, tx, pWX, W/2, z, F), x1 = snapTileEdge(tileOriginX, tx + 1, pWX, W/2, z, F);
      const y0 = snapTileEdge(tileOriginY, ty, pWY, H/2, z, F), y1 = snapTileEdge(tileOriginY, ty + 1, pWY, H/2, z, F);
      const dw = x1 - x0, dh = y1 - y0;
      if(dw <= 0 || dh <= 0) continue;
      const kx = dw / fogTilePx, ky = dh / fogTilePx;
      fogCtx.save();
      fogCtx.beginPath(); fogCtx.rect(x0, y0, dw, dh); fogCtx.clip();
      fogCtx.drawImage(t.cv, x0 - M * kx, y0 - M * ky, t.cv.width * kx, t.cv.height * ky);
      fogCtx.restore();
    }
  }
  if(CONFIG.DEBUG) fogStats.composeMs += performance.now() - t0;
}
// 霧タイルの状態（検証・開発確認用）
function fogTileInfo(){
  let px = 0; for(const t of fogTiles.values()) px += t.cv.width * t.cv.height;
  return { tiles: fogTiles.size, px, bytes: px * 4, tileWorldPx: fogTileWorldPx, tilePx: fogTilePx, warned: fogTileWarned, stats: Object.assign({}, fogStats) };
}

const PLAYER_R_PX = 14, CHEST_SIZE_PX = 24, BOSS_SIZE_PX = 30;
const PICKUP_DIST_PX = PLAYER_R_PX + CHEST_SIZE_PX/2;
const BOSS_DIST_PX = PLAYER_R_PX + BOSS_SIZE_PX/2;
const CHEST_OPEN_FRAME_MS = 80; // スプライトシート1コマの表示時間
const CHEST_OPEN_ANIM_MS = CHEST_OPEN_FRAME_MS * 9; // 9コマ分

let state = {};

// Fisher-Yatesシャッフル。元の配列は書き換えず、シャッフル済みの新しい配列を返す
function shuffleArray(arr, rnd){ // rnd：乱数関数（省略時は gameRandom。デイリーの盤面生成は生成用ストリームを渡す）
  const a = arr.slice();
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor((rnd ? rnd() : gameRandom()) * (i + 1));
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
// ==== スポーン・宝箱・ヒント掲示板の配置 ====
// 県の大きさ R（県庁から県境までの最大距離）に対する割合と、難易度で決める。距離（km）の換算は既存の KM_PER_DEG_LAT／kmPerDegLonAt。
// 経度方向は2点の中間緯度で換算し、destLatLon（距離・方位→緯度経度）はその逆の式なので、作った点の実距離は指定どおりになる。
// 抽選は clampToBounds を通さない（県外で端に丸められて距離が変わるため）。乱数はすべて gameRandom。
function kmBetween(latA, lonA, latB, lonB){
  const dy = (latB - latA) * KM_PER_DEG_LAT;
  const dx = (lonB - lonA) * kmPerDegLonAt((latA + latB) / 2);
  return Math.hypot(dx, dy);
}
// 中心(lat,lon)から、距離distKm・方位angleRad(0=北,時計回り)の緯度経度（クランプなし）
function destLatLon(lat, lon, distKm, angleRad){
  const nLat = lat + distKm * Math.cos(angleRad) / KM_PER_DEG_LAT;
  const nLon = lon + distKm * Math.sin(angleRad) / kmPerDegLonAt((lat + nLat) / 2);
  return { lat: nLat, lon: nLon };
}
// R：県庁（CAPITAL）から県境（PREFECTURE_RING の全頂点）までの最大距離(km)。initGame のたびに計算する
function computePrefectureRadiusKm(){
  let r = 0;
  for(let i = 0; i < PREFECTURE_RING.length; i++){
    const d = kmBetween(CAPITAL.lat, CAPITAL.lon, PREFECTURE_RING[i][1], PREFECTURE_RING[i][0]);
    if(d > r) r = d;
  }
  return r;
}
// 置いてよい地形：データがあり、地形コードが1以上で、14（河川・湖沼）・15（海浜）・16（海水域）以外
function isPlaceableTerrain(lat, lon){
  const code = getLanduseCode(lat, lon);
  if(code === null || code === undefined) return false;
  const n = Number(code);
  return n >= 1 && n !== 14 && n !== 15 && n !== 16;
}
// スポーンの採用条件：県内・置ける地形・周囲200mの8方向のうち6方向以上が県内で通行可能
function isValidSpawnPoint(lat, lon){
  if(!isInsidePrefecture(lat, lon) || !isPlaceableTerrain(lat, lon)) return false;
  let ok = 0;
  for(let k = 0; k < 8; k++){
    const p = destLatLon(lat, lon, 0.2, k * Math.PI / 4);
    if(isInsidePrefecture(p.lat, p.lon) && isPassable(p.lat, p.lon)) ok++;
  }
  return ok >= 6;
}
// スポーン：県庁から距離 d（[lo,hi] の一様乱数）・方位（一様乱数）の地点。
//   lo = max(SPAWN_MIN_KM, min(pctLo×R, spawnMaxKm×0.6))、hi = max(lo+1, min(pctHi×R, spawnMaxKm))
//   見つからなければ、範囲を段階的に広げて（lo×0.7、hi×1.15、最大4段階）再試行。それでも無ければ、範囲に最も近い候補（console.warnのみ）。
function chooseSpawn(R, diff, rnd){
  const rand = rnd || (() => gameRandom()); // 省略時は従来どおり gameRandom（通常プレイの乱数の順序は変えない）
  const lo0 = Math.max(CONFIG.SPAWN_MIN_KM, Math.min(diff.spawnPct[0] * R, diff.spawnMaxKm * 0.6));
  const hi0 = Math.max(lo0 + 1, Math.min(diff.spawnPct[1] * R, diff.spawnMaxKm));
  const make = (p, stage, relaxed) => ({ lat: p.lat, lon: p.lon, distKm: kmBetween(CAPITAL.lat, CAPITAL.lon, p.lat, p.lon),
                                         R: R, lo: lo0, hi: hi0, stage: stage, relaxed: relaxed });
  let best = null; // 条件を満たす候補が1つも無かった時の代用（県内・地形が良い・範囲からの外れが小さい順）
  for(let stage = 0; stage <= 4; stage++){
    const lo = lo0 * Math.pow(0.7, stage), hi = hi0 * Math.pow(1.15, stage);
    for(let t = 0; t < CONFIG.SPAWN_TRIES; t++){
      const d = lo + rand() * (hi - lo);
      const a = rand() * Math.PI * 2;
      const p = destLatLon(CAPITAL.lat, CAPITAL.lon, d, a);
      if(isValidSpawnPoint(p.lat, p.lon)) return make(p, stage, false);
      if(!isInsidePrefecture(p.lat, p.lon)) continue;
      const tier = isPlaceableTerrain(p.lat, p.lon) ? 0 : 1;
      const viol = d < lo0 ? lo0 - d : (d > hi0 ? d - hi0 : 0);
      if(!best || tier < best.tier || (tier === best.tier && viol < best.viol)) best = { tier: tier, viol: viol, p: p };
    }
  }
  console.warn('[spawn] 条件を満たす地点が見つからなかったため、範囲に最も近い候補を使います（R=' + R.toFixed(1) + 'km, 範囲=' + lo0.toFixed(1) + '〜' + hi0.toFixed(1) + 'km）');
  return make(best ? best.p : { lat: CAPITAL.lat, lon: CAPITAL.lon }, 5, true);
}
// ---- 宝箱数・アイテム効果の「県の規模」スケール（すべて CONFIG の定数。spawnMaxKm＝難易度の規模） ----
// 宝箱数の基準値・範囲（デバッグ表 ?debug=params でも使う）。基準値＝round(spawnMaxKm÷KM_PER_CHEST)、公称値＝基準値×chestCountMul、範囲＝公称値×(1±CHEST_RANDOM_RANGE)を四捨五入して CHEST_MIN〜CHEST_MAX に収める
function chestCountRange(diff){
  const base = Math.round(diff.spawnMaxKm / CONFIG.KM_PER_CHEST);
  const nominal = base * diff.chestCountMul;
  const clampN = v => Math.max(CONFIG.CHEST_MIN, Math.min(CONFIG.CHEST_MAX, Math.round(v)));
  return { base: base, nominal: nominal, min: clampN(nominal * (1 - CONFIG.CHEST_RANDOM_RANGE)), max: clampN(nominal * (1 + CONFIG.CHEST_RANDOM_RANGE)) };
}
// そのランの宝箱数：公称値に gameRandom で ±CHEST_RANDOM_RANGE の幅を持たせ、四捨五入して CHEST_MIN〜CHEST_MAX に収める
function computeChestCount(diff){
  const r = chestCountRange(diff);
  const v = r.nominal * (1 + (gameRandom() * 2 - 1) * CONFIG.CHEST_RANDOM_RANGE);
  return Math.max(CONFIG.CHEST_MIN, Math.min(CONFIG.CHEST_MAX, Math.round(v)));
}
// デイリーの宝箱数：ランダム幅（CHEST_RANDOM_RANGE）を適用せず、基準値（round(spawnMaxKm÷KM_PER_CHEST) × chestCountMul）を四捨五入して CHEST_MIN〜CHEST_MAX に収めた値に固定
function dailyChestCount(diff){
  const r = chestCountRange(diff);
  return Math.max(CONFIG.CHEST_MIN, Math.min(CONFIG.CHEST_MAX, Math.round(r.nominal)));
}
// デイリーの宝箱の中身：生成時に、宝箱の番号順（1番目から）で事前に決める。上限（ITEM_MAX_PER_RUN）と県の条件による除外（itemAvailable）は、この決定時に適用する。
// 取得した順では変わらない。stats＝その県の地形の統計（ゲーム内は prefLandStats、?debug=daily は fetch した値で、同じ値）
function buildDailyLoot(n, rnd, stats){
  const counts = {}, list = [];
  for(let i = 0; i < n; i++){ const it = pickChestItem(counts, null, stats, rnd); counts[it] = (counts[it] || 0) + 1; list.push(it); }
  return list;
}
// アイテム効果のスケール：clamp(spawnMaxKm ÷ ITEM_REF_KM, 1, ITEM_SCALE_MAX)
function itemScaleFor(diff){ return Math.max(1, Math.min(CONFIG.ITEM_SCALE_MAX, diff.spawnMaxKm / CONFIG.ITEM_REF_KM)); }
function timeItemSecFor(scale){ return Math.round(CONFIG.TIME_ITEM_BASE_SEC * scale); }          // 時間アイテムの秒数（整数）
function speedBoostSecFor(scale){ return CONFIG.BIKE_DURATION_SEC * scale; }                      // スピードアイテムの効果時間（秒）。倍率 SPEED_BIKE_MULT はスケールしない
function gliderSecFor(scale){ return CONFIG.GLIDER_BASE_SEC * scale; }                              // グライダーの効果時間（秒）
function carSecFor(scale){ return CONFIG.CAR_BASE_SEC * scale; }                                    // 車の効果時間（秒）。倍率 CAR_SPEED_MUL はスケールしない

// 掲示板（1問に1枚・重複なし）と宝箱をまとめて配置する（掲示板を先に置く）。
//   モードA 'prefecture'：県の外接矩形から一様乱数で点を取り、条件を満たすものを採用（面積に比例して散る）
//   モードB 'reachable' ：スポーン中心・半径 spawnMaxKm×ITEM_REACH_FACTOR の円から面積に比例して（r=半径×√u）点を取り、同じ条件で採用
//   共通条件：県内／置ける地形／スポーン・県庁からの最小距離／既存の点との最小間隔。
//   1点あたり PLACE_TRIES 回で見つからなければ、最小間隔を0.8倍にして再試行（最大5回）。それでも置けなければ置ける数で続行（console.warnのみ）。
function placeBoardsAndChests(spawn, diff, mode, rollItem, rnd, fixedChestN){
  const rand = rnd || (() => gameRandom()); // 省略時は従来どおり gameRandom（通常プレイの乱数の順序は変えない）。rollItem(i)：i番目の宝箱の中身
  let lonMin_ = Infinity, lonMax_ = -Infinity, latMin_ = Infinity, latMax_ = -Infinity;
  PREFECTURE_RING.forEach(([lon, lat])=>{
    if(lon < lonMin_) lonMin_ = lon; if(lon > lonMax_) lonMax_ = lon;
    if(lat < latMin_) latMin_ = lat; if(lat > latMax_) latMax_ = lat;
  });
  const reachKm = diff.spawnMaxKm * CONFIG.ITEM_REACH_FACTOR;
  const sample = (mode === 'reachable')
    ? () => { const r = reachKm * Math.sqrt(rand()); const a = rand() * Math.PI * 2; return destLatLon(spawn.lat, spawn.lon, r, a); }
    : () => ({ lat: latMin_ + rand() * (latMax_ - latMin_), lon: lonMin_ + rand() * (lonMax_ - lonMin_) });
  const placed = [];
  const stats = { boardsWanted: 0, boardsPlaced: 0, chestsWanted: 0, chestsPlaced: 0, relaxed: 0, failed: 0 };
  function placeOne(){
    for(let k = 0; k <= 5; k++){
      const sep = CONFIG.PLACE_MIN_SEP_KM * Math.pow(0.8, k);
      for(let t = 0; t < CONFIG.PLACE_TRIES; t++){
        const p = sample();
        if(!isInsidePrefecture(p.lat, p.lon) || !isPlaceableTerrain(p.lat, p.lon)) continue;
        if(kmBetween(spawn.lat, spawn.lon, p.lat, p.lon) < CONFIG.PLACE_MIN_FROM_SPAWN_KM) continue;
        if(kmBetween(CAPITAL.lat, CAPITAL.lon, p.lat, p.lon) < CONFIG.PLACE_MIN_FROM_CAPITAL_KM) continue;
        let near = false;
        for(let i = 0; i < placed.length; i++){ if(kmBetween(placed[i].lat, placed[i].lon, p.lat, p.lon) < sep){ near = true; break; } }
        if(near) continue;
        placed.push(p);
        if(k > 0) stats.relaxed++;
        return p;
      }
    }
    stats.failed++;
    return null;
  }
  const n = Math.min(CONFIG.HINT_BOARD_COUNT, currentKnowledge.length);
  stats.boardsWanted = n;
  const boards = [];
  shuffleArray(currentKnowledge, rnd).slice(0, n).forEach(q=>{ // 1問に1枚、重複なし
    const p = placeOne();
    if(p) boards.push({ lat: p.lat, lon: p.lon, questionId: q.id, state: 'active' });
  });
  stats.boardsPlaced = boards.length;
  const chestN = (fixedChestN !== undefined) ? fixedChestN : computeChestCount(diff); // 掲示板を置いた後に決める（掲示板の配置の乱数列を変えない）。デイリーは固定の数
  stats.chestsWanted = chestN;
  const chests = [];
  for(let i = 0; i < chestN; i++){
    const p = placeOne();
    if(p) chests.push({ lat: p.lat, lon: p.lon, item: rollItem(i), state: 'closed', openStart: 0 });
  }
  stats.chestsPlaced = chests.length;
  if(stats.failed > 0) console.warn('[place] 置けなかった点が ' + stats.failed + ' 個あります（掲示板 ' + boards.length + '/' + n + '、宝箱 ' + chests.length + '/' + chestN + '）');
  return { boards: boards, chests: chests, stats: stats };
}

// デイリーのクイズ：出題の順番（掲示板の問題を置いた順 → 残りの問題）と、各問題の選択肢の並び・50-50で残す不正解を、生成時に固定する（プレイ中の行動で変わらない）。
// ヒント掲示板の問題が先頭に来るので、掲示板を探して読めば、ボス戦で出る問題のヒントが手に入る
function buildDailyQuiz(boards, rnd){
  const boardIds = boards.map(b => b.questionId);
  const rest = shuffleArray(currentKnowledge.filter(q => boardIds.indexOf(q.id) < 0), rnd).map(q => q.id);
  const order = boardIds.concat(rest), shown = {}, keep = {};
  order.forEach(id => {
    const q = currentKnowledge.find(x => x.id === id);
    shown[id] = shuffleArray(q.options, rnd);
    const wrong = shown[id].filter(o => o !== knowledgeCorrectText(q));
    keep[id] = wrong[Math.floor(rnd() * wrong.length)];
  });
  return { order: order, shown: shown, keep: keep };
}
// 宝箱の中身：'time'（+10秒）／'speed'（スピードアップ）／'fifty'（✂️50-50）／'compass'（🧭県庁サーチ）。抽選は items.js の pickChestItem()。
function initGame(){
  resize();
  resetFogTiles(); // 探索状態を初期化（霧タイルをすべて破棄。前のランの探索は引き継がない）

  const diff = gameSettings.difficulty;
  // デイリー：盤面の生成は、その日の seed から作る生成用ストリーム（spawn／place／loot／quiz）だけで行う。プレイ中の抽選（gameRandom）は別のストリーム（play）。
  // ラン（再挑戦）のたびに、全部 seed から作り直すので、何度やっても同じ盤面・同じ乱数になる
  const dly = dailyPlan ? { spawn: dailyStream(dailyPlan, 'spawn'), place: dailyStream(dailyPlan, 'place'), loot: dailyStream(dailyPlan, 'loot'),
                            quiz: dailyStream(dailyPlan, 'quiz'), play: dailyStream(dailyPlan, 'play') } : null;
  if(dly) setGameRandom(dly.play);

  // ① スポーン地点：県の大きさ R に対する割合と難易度で決める（chooseSpawn）。R は起動のたびに計算する
  const R = computePrefectureRadiusKm();
  const spawn = chooseSpawn(R, diff, dly ? dly.spawn : undefined);

  state = {
    player: { lat: spawn.lat, lon: spawn.lon },
    spawn: { lat: spawn.lat, lon: spawn.lon },
    spawnInfo: spawn,      // R・使った距離範囲・実距離・フォールバックの段階（デバッグ・検証用。画面には出さない）
    chests: [],
    boss: { lat: CAPITAL.lat, lon: CAPITAL.lon, sizePx: BOSS_SIZE_PX },
    timeLeft: CONFIG.TIME_LIMIT_SEC, // 全難易度・全県共通
    itemScale: itemScaleFor(diff),   // 時間・スピードアイテムの県の規模スケール（items.js）
    speedBoostUntil: 0, // スピードアップの終了時刻(performance.now基準)。0＝非発動
    speedKind: 'speed', // 速度系スロットの種類：'speed'（倍率 SPEED_BIKE_MULT）／'car'（倍率 CAR_SPEED_MUL）。速度系は1スロットのみで、新しく取った方が上書きする
    gliderUntil: 0, gliderDurationMs: 0, // グライダー（減速無効）の終了時刻・効果時間。速度系とは独立で、同時に有効にできる
    running: true,
    mode: 'playing',
    quizStep: 0,
    hintBoards: [],        // ヒント掲示板
    readHintIds: new Set(), // 今回のランで掲示板から読んだ問題ID（ラン開始ごとにリセット）
    askedIds: new Set(),    // 今回のランでボス戦に出題済みの問題ID（ラン開始ごとにリセット）
    lastAskedId: null,      // 直前に出題した問題ID
    currentQuiz: null,      // 出題中の問題（シャッフル後の選択肢・正解文字列など）
    fiftyFiftyStock: 0,     // ✂️50-50の所持数（ラン開始で0にリセット）
    compassActive: false,   // 🧭県庁サーチが発動済みか（ラン開始で未発動にリセット）
    daily: dailyPlan ? { date: dailyPlan.date, quiz: null } : null // デイリーの情報（通常プレイは null）。quiz：その日に固定した出題順・選択肢の並び
  };
  timerEl.textContent = state.timeLeft;

  // 宝箱の中身を抽選する。🧭は1つ割り当てたら、同じラン内の残りの宝箱の抽選から外す（2個目は意味がないため）
  // 中身の抽選：そのランで決めた数（種類ごと）を数え、上限（CONFIG.ITEM_MAX_PER_RUN）に達した種類を候補から外す。カウントは initGame（＝1プレイごと）でリセットされる
  state.itemCounts = {};
  const rollChestItem = ()=>{
    const it = pickChestItem(state.itemCounts);
    state.itemCounts[it] = (state.itemCounts[it] || 0) + 1;
    return it;
  };

  // ② 掲示板（20個・1問1枚）と宝箱（難易度の個数）を、まとめて配置（掲示板が先）
  let placed;
  if(dly){
    // デイリー：宝箱数は基準値に固定。中身は、宝箱の番号順に事前に決める（上限・県の条件による除外は、この決定時に適用）
    const chestN = dailyChestCount(diff);
    const lootList = buildDailyLoot(chestN, dly.loot, prefLandStats);
    state.itemCounts = {}; lootList.forEach(it => { state.itemCounts[it] = (state.itemCounts[it] || 0) + 1; });
    placed = placeBoardsAndChests(spawn, diff, gameSettings.scatterMode, (i) => lootList[i], dly.place, chestN);
    state.daily.quiz = buildDailyQuiz(placed.boards, dly.quiz);
  } else {
    placed = placeBoardsAndChests(spawn, diff, gameSettings.scatterMode, rollChestItem);
  }
  state.hintBoards = placed.boards;
  state.chests = placed.chests;
  state.placeInfo = placed.stats;
  chestTotalEl.textContent = state.chests.length;
  chestCountEl.textContent = 0;

  debugLog('[init] 難易度=' + gameSettings.difficultyKey + ' モード=' + gameSettings.scatterMode + ' R=' + R.toFixed(1) + 'km スポーン範囲=' +
           spawn.lo.toFixed(1) + '〜' + spawn.hi.toFixed(1) + 'km 実距離=' + spawn.distKm.toFixed(1) + 'km（段階' + spawn.stage + (spawn.relaxed ? '・代用' : '') +
           '） 掲示板=' + placed.stats.boardsPlaced + '/' + placed.stats.boardsWanted + ' 宝箱=' + placed.stats.chestsPlaced + '/' + placed.stats.chestsWanted +
           ' 間隔を緩めた点=' + placed.stats.relaxed);

  hideAllOverlays();
  resetHintUI(); // ヒントのパネル／一覧／ボタン表示を初期状態へ（ui.js）
  boostHud.classList.remove('show'); gliderHud.classList.remove('show');
  state.mapReveals = [];  // 宝箱地図で晴らした円の記録（中心・半径。検証用。霧そのものは霧タイル・ミニマップのマスクに残る）
  resetPauseState();      // ラン開始でポーズ状態を解除（再プレイ時の取りこぼし防止）
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
  const gliding = now < state.gliderUntil; // グライダー：森林・河川の減速を無効にする（速度系とは独立）
  let speedMult = 1;
  let targetSheet = SHEET_PLAYER_RUN, frameMs = CONFIG.ANIM_FRAME_MS_NORMAL;
  if(landCode === LANDUSE_FOREST){
    speedMult = gliding ? 1 : CONFIG.SPEED_FOREST_MULT;
    targetSheet = SHEET_PLAYER_WALK; frameMs = CONFIG.ANIM_FRAME_MS_FOREST;
  } else if(landCode === LANDUSE_RIVER){
    speedMult = gliding ? 1 : CONFIG.RIVER_SPEED_MULTIPLIER; // 森林よりさらに遅い（グライダー中は減速なし）
    targetSheet = SHEET_PLAYER_KAYAK; frameMs = CONFIG.ANIM_FRAME_MS_KAYAK; // 川ではカヤック表示（スピードアップ中も優先）
  }
  if(boosting){
    speedMult *= (state.speedKind === 'car') ? CONFIG.CAR_SPEED_MUL : CONFIG.SPEED_BIKE_MULT; // 地形の倍率の上に掛け算で重ねる（車はスピードの上位版）
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
      // 🗺が出たが、取れる（未取得の）宝箱がもう無いなら、別のアイテムに引き直す
      // （デイリーは中身が生成時に決まっているので、取得順で変えない＝この2つの引き直しは通常プレイだけ）
      if(!state.daily && c.item === 'map' && !itemAvailable('map')){ state.itemCounts.map = Math.max(0, (state.itemCounts.map || 1) - 1); c.item = pickChestItem(state.itemCounts, ['map']); state.itemCounts[c.item] = (state.itemCounts[c.item] || 0) + 1; }
      if(!state.daily && c.item === 'compass' && state.compassActive){ state.itemCounts.compass = Math.max(0, (state.itemCounts.compass || 1) - 1); c.item = pickChestItem(state.itemCounts, ['compass']); state.itemCounts[c.item] = (state.itemCounts[c.item] || 0) + 1; }
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
// ---- 1フレームの描画時間の内訳（CONFIG.DEBUG または ?debug=1 の時だけ計測。通常は何もしない）----
// frameProf = { bake, terrain, river, rail, sprites, fog, ui }（ミリ秒）。bake＝タイルのbake（地形・鉄道・河川の共有予算）、
// terrain＝地形タイルの貼り付け＋県境線、river／rail＝線タイルの貼り付け、sprites＝宝箱・掲示板・県庁・探検家、fog＝霧の合成、ui＝ミニマップ。
let frameProf = null, _profT = 0;
function profBegin(){ if(CONFIG.DEBUG){ frameProf = { bake: 0, terrain: 0, river: 0, rail: 0, sprites: 0, fog: 0, ui: 0 }; _profT = performance.now(); } }
// CONFIG.DEBUG_PROF_SYNC が true の時は、各区間の終わりでcanvasの描画命令を強制的に確定させる（getImageData）。
// canvas2Dは描画命令を溜めて後でまとめて実行するため、同期しないと「重い処理の時間が、あとで確定が起きる別の区間に付く」。同期すると区間ごとの内訳が正確になるが、全体は少し遅くなる。
function profLap(name){ if(frameProf){ if(CONFIG.DEBUG_PROF_SYNC) ctx.getImageData(0, 0, 1, 1); const t = performance.now(); frameProf[name] += t - _profT; _profT = t; } }

function draw(){
  profBegin();
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

  // 遊んでいる県以外の都道府県：地味な単色でベタ塗りするだけ（装飾なし）
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

  // 土地利用の地形（タイル）：PREFECTURE_RINGでクリップして描画
  ctx.save();
  ctx.beginPath();
  PREFECTURE_RING.forEach(([lon,lat], i)=>{
    const [sx, sy] = toScreen(worldX(lon), worldY(lat));
    if(i===0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
  ctx.clip();
  // タイルのキャッシュ更新：必要なタイル（地形のテクスチャ・鉄道・河川）のbakeを、共有の予算内で予約・実行する（terrain.js）
  updateTileCaches(pWX, pWY, z, toggleTexture.checked, toggleRail.checked, toggleRiver.checked);
  profLap('bake');
  // 地形：画面に映るタイルだけをタイルキャッシュから貼る（terrain.js の drawTerrainTiles）。
  // テクスチャON＆焼き込み済みならテクスチャタイル、それ以外（OFF・読み込み中・未生成）は単色タイルを、タイルごとに選ぶ。
  drawTerrainTiles(pWX, pWY, z, toggleTexture.checked);
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

  profLap('terrain');

  // 河川・鉄道：地形と同じタイル格子・同じスナップ関数で、焼き済みの線タイルを貼る（terrain.js の drawLineTiles）。
  // 河川は地形テクスチャの上・鉄道より下、鉄道は宝箱・県庁・探検家より下。ズーム変換の中で描くので、ズームしても地形・鉄道・河川が常に一致する。
  if(toggleRiver.checked) drawLineTiles(riverLayer, pWX, pWY, z);
  profLap('river');
  if(toggleRail.checked) drawLineTiles(railLayer, pWX, pWY, z);
  profLap('rail');

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

  // 宝箱・掲示板の目印（▼／◆）。スプライトの直後・プレイヤーの前・霧の前なので、霧の下では見えない（items.js）
  drawItemMarkers(toScreen, z, now);

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
  profLap('sprites');
  ctx.restore(); // カメラズームここまで

  // ② Fog of War オーバーレイ（探索済み以外を覆う。これが③の県庁非表示も兼ねる）
  fogCtx.clearRect(0,0,W,H);
  fogCtx.fillStyle = 'rgba(4,8,14,0.93)';
  fogCtx.fillRect(0,0,W,H);
  fogCtx.globalCompositeOperation = 'destination-out';
  drawFogTiles(pWX, pWY, z); // 画面に映る範囲の霧タイル（探索済み）で、霧を消す
  fogCtx.globalCompositeOperation = 'source-over';
  ctx.drawImage(fogCanvas, 0, 0);
  profLap('fog');

  // ④ ミニマップ（探索済みシルエットのみ、地名なし）
  drawMinimap(pWX, pWY);
  profLap('ui');
}

// ミニマップ用の使い回しキャンバス（霧オーバーレイの合成用）。サイズはワールド比で固定なので一度だけ作る。
// ==== ポーズ ====
// ポーズ中は、dt・制限時間・効果時間・霧・アニメ・入力による移動をすべて止め（loop が更新も描画もしない）、不透明なオーバーレイ（#pauseOverlay）で
// マップ・ミニマップ・クイズの問題文・ヒント一覧をすべて隠す（推理の抜け道を作らない）。表示するのは「再開」ボタンだけ。
// 時刻（performance.now 基準）で持っている状態（効果の終了時刻・宝箱の開封アニメ・通知／ヒントパネル／誤答トーストのタイマー）は、再開時にポーズした時間ぶんずらす。
// 自動ポーズ（画面が見えなくなった／ウィンドウが blur）の後も、自動では再開しない。連打・二重ポーズは無害（pauseGame／resumeGame は冪等）。
let paused = false, pauseStartMs = 0, pendingEnd = null;
const pauseOverlay = document.getElementById('pauseOverlay'), pauseNote = document.getElementById('pauseNote');
const pausableTimers = new Set();
// ポーズで止まる setTimeout（通知・ヒントパネルの自動閉じ・誤答トーストなど、ゲーム内の時間で進める UI 用）
function pausableTimeout(fn, ms){
  const t = { fn: fn, remaining: ms, start: 0, id: null };
  const arm = ()=>{ t.start = performance.now(); t.id = setTimeout(()=>{ t.id = null; pausableTimers.delete(t); fn(); }, Math.max(0, t.remaining)); };
  t.arm = arm; pausableTimers.add(t);
  if(!paused) arm();
  return t;
}
function clearPausableTimeout(t){ if(!t) return; if(t.id !== null) clearTimeout(t.id); pausableTimers.delete(t); }
function clearKeys(){ for(const k in keys) keys[k] = false; }
// ポーズできる状況：ループが動いていて、フィールド（playing）かボス戦（quiz。クイズ中を含む）の時
function canPause(){
  return loopStarted && state && (state.mode === 'playing' || state.mode === 'quiz');
}
function pauseGame(auto){
  if(paused || !canPause()) return false;
  paused = true; pauseStartMs = performance.now();
  clearKeys();
  pausableTimers.forEach(t => { if(t.id !== null){ clearTimeout(t.id); t.id = null; t.remaining -= (pauseStartMs - t.start); } });
  if(pauseNote) pauseNote.textContent = auto ? '画面が切り替わったため、一時停止しました' : '';
  pauseOverlay.classList.add('show');
  return true;
}
function resumeGame(){
  if(!paused) return false;
  const t = performance.now(), delta = Math.max(0, t - pauseStartMs);
  // 時刻で持っている状態を、ポーズした時間ぶん進める
  if(state.speedBoostUntil > 0) state.speedBoostUntil += delta;
  if(state.gliderUntil > 0) state.gliderUntil += delta;
  state.chests.forEach(c => { if(c.state === 'opening') c.openStart += delta; });
  paused = false;
  lastTime = t; lastFrameTime = null; // 前フレーム時刻を現在時刻にリセット：再開後の最初のフレームの dt・制限時間の経過が巨大にならない
  pausableTimers.forEach(x => { if(x.id === null) x.arm(); });
  clearKeys();
  pauseOverlay.classList.remove('show');
  if(pendingEnd !== null){ const w = pendingEnd; pendingEnd = null; endGame(w); }
  return true;
}
function resetPauseState(){
  paused = false; pendingEnd = null; pauseOverlay.classList.remove('show');
  pausableTimers.forEach(t => { if(t.id !== null) clearTimeout(t.id); }); pausableTimers.clear();
}
if(CONFIG.AUTO_PAUSE){
  document.addEventListener('visibilitychange', ()=>{ if(document.hidden) pauseGame(true); });
  window.addEventListener('blur', ()=>{ pauseGame(true); });
}

// ==== ゲームループ（デルタタイム方式） ====
// rAFのタイムスタンプ差から dt を求める。最初のフレームは 1/60 秒。上限は CONFIG.DT_MAX_SEC。
// タブが非表示→表示に戻った時は前フレームのタイムスタンプを捨てる（戻った最初のフレームは 1/60 秒）。
// 残り時間タイマーだけは従来どおり実時間（rawMs＝lastTime との差、頭打ちなし）で減らす。
let lastFrameTime = null;
document.addEventListener('visibilitychange', ()=>{ lastFrameTime = null; });
let loopStarted = false; // ループが始まったか（読み込み中・選択画面ではポーズ不可にするため）
function loop(now){
  loopStarted = true;
  if(paused){ // ポーズ中：更新も描画もしない（dt・制限時間・効果時間・霧・アニメ・移動がすべて止まる）。再開時に基準時刻を取り直すので、ここでは何も溜めない
    lastTime = now; lastFrameTime = null;
    requestAnimationFrame(loop);
    return;
  }
  updatePauseButton(); // ui.js：ポーズボタンの有効／無効
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
let debugHudEl = null, debugAccumSec = 0, debugFrames = 0, debugText = '', debugProfAcc = null;
function updateDebugHud(dtSec, rawDtSec){
  if(!debugHudEl){
    debugHudEl = document.createElement('div');
    debugHudEl.id = 'debugHud';
    debugHudEl.style.cssText = 'position:absolute;left:4px;bottom:3px;z-index:40;pointer-events:none;white-space:pre;font:10px/1.3 monospace;color:#9fffd0;background:rgba(0,0,0,0.55);padding:1px 5px;border-radius:3px;';
    wrap.appendChild(debugHudEl);
  }
  debugAccumSec += rawDtSec; debugFrames++;
  if(frameProf){ if(!debugProfAcc) debugProfAcc = { bake: 0, terrain: 0, river: 0, rail: 0, sprites: 0, fog: 0, ui: 0 }; for(const k in debugProfAcc) debugProfAcc[k] += frameProf[k]; }
  if(debugAccumSec >= 0.5){ // 0.5秒ごとに平均して表示（数字がチラつかないように）
    const avgDt = debugAccumSec / debugFrames;
    debugText = 'dt ' + (avgDt * 1000).toFixed(1) + 'ms  ' + (1 / avgDt).toFixed(0) + 'fps  x' + (avgDt * 60).toFixed(2);
    if(debugProfAcc){ // 描画の内訳（ms/フレームの平均）：bake・地形・河川・鉄道・スプライト・霧・UI
      const f = (k)=> (debugProfAcc[k] / debugFrames).toFixed(1);
      debugText += '\nbake ' + f('bake') + ' terr ' + f('terrain') + ' river ' + f('river') + ' rail ' + f('rail') + ' spr ' + f('sprites') + ' fog ' + f('fog') + ' ui ' + f('ui');
      debugProfAcc = null;
    }
    debugAccumSec = 0; debugFrames = 0;
  }
  debugHudEl.textContent = debugText || 'dt ...';
}

// ==== クイズ ====
function endGame(won){
  if(paused){ pendingEnd = won; return; } // ポーズ中は結果画面を出さない（再開した時に反映する）
  state.mode = won ? 'clear' : 'gameover';
  updateHintButtonVisibility(); // ui.js：フィールドで遊んでいる間（playing）だけヒントボタンを表示
  showDailyResult(won);         // デイリー：今回の結果を localStorage に記録し、結果画面に「今日のチャレンジ」と日付・今日のベストを出す
  if(won) clearOverlay.classList.add('show'); else gameOverOverlay.classList.add('show');
}
// 結果画面のデイリー表示（通常プレイでは非表示）。クリアの残り秒数は、残り時間を切り上げた整数
function showDailyResult(won){
  const boxes = [document.getElementById('dailyBoxClear'), document.getElementById('dailyBoxOver')];
  if(!state.daily){ boxes.forEach(b => { if(b) b.style.display = 'none'; }); return; }
  const remain = won ? Math.max(0, Math.ceil(state.timeLeft)) : 0;
  const rec = recordDailyResult(state.daily.date, won, remain);
  boxes.forEach(b => {
    if(!b) return;
    b.style.display = 'block';
    b.querySelector('.dailyTitle').textContent = '📅 今日のチャレンジ　' + dateLabel(state.daily.date);
    b.querySelector('.dailyThis').textContent = '今回：' + (won ? 'クリア　残り ' + remain + '秒' : '未クリア');
    b.querySelector('.dailyBest').textContent = dailyBestText(rec);
  });
}

// 再プレイ：難易度の選択画面を出す設定なら、選択画面に戻る（県は変えない）。選ばれたら、新しいスポーン位置の画面内のタイルを先に焼いて開始。
// 出さない設定（?diff=指定／SHOW_DIFFICULTY_SELECT=false）なら、従来どおり同じ難易度ですぐ再開する
window.resetGame = function(){
  const restart = ()=>{ initGame(); prebakeTerrainAtPlayer(0); };
  if(dailyPlan){ restart(); return; } // デイリー：同じ盤面ですぐ再挑戦（何度でも。seed から作り直すので同じ盤面・同じ乱数）
  if(difficultySelectEnabled) showDifficultySelect(restart); // ui.js
  else restart();
};

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

  // ⓪ デイリー：県は日付のハッシュで決まる（?pref= や CONFIG の指定より優先）。決まった県が読めなかった時は、残りの県（コード順）から日付のハッシュで選び直す
  if(dailyPlan){
    const ordered = candidates.slice().sort((a, b) => a - b);
    if(ordered.includes(dailyPlan.pref)) return dailyPlan.pref;
    return ordered[hash32(CONFIG.DAILY_SALT + ':' + dailyPlan.date + ':pref') % ordered.length];
  }

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
  return candidates[Math.floor(gameRandom() * candidates.length)];
}

// 県データが読めなかった時の表示（読み込み中の画面を使う。ゲームは開始しない）
function showStartError(msg){
  const dOv = document.getElementById('difficultyOverlay'); // 選択画面は閉じて、エラーだけを表示する
  if(dOv) dOv.classList.remove('show');
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
  // 難易度の選択画面を出す設定なら、選ばれてから最初のラン（initGame）を始める。出さない設定（?diff=指定／SHOW_DIFFICULTY_SELECT=false）なら、すぐ始める
  if(difficultySelectEnabled) showDifficultySelect(startFirstRun); // ui.js
  else startFirstRun();
}
// 最初のラン：ラン単位の初期化（スポーン・宝箱・霧・タイマー）→ テクスチャの読み込みを待ち、スポーン周辺（画面＋1周）の
// 地形タイルを先に焼いてから、読み込み中の表示を消してループを始める
function startFirstRun(){
  const loadingOverlay = document.getElementById('loadingOverlay');
  if(loadingOverlay){ const m = document.getElementById('loadingMsg'); if(m) m.textContent = '読み込み中…'; loadingOverlay.classList.add('show'); }
  initGame();              // ラン単位の初期化（スポーン・宝箱・霧・タイマー）。難易度は gameSettings（選択画面 or URL/CONFIG）
  terrainStartWhenReady(()=>{
    if(loadingOverlay) loadingOverlay.classList.remove('show');
    requestAnimationFrame(loop);
  });
}

// ==== デバッグ：?debug=params で、現在読み込める全県 × 4難易度の表を console.table で出す（通常起動では何も出さない） ====
// 県の地形の統計（森林率+河川率・陸地面積）は、各県の data_mesh.js を fetch して、ゲームと同じ展開・計算（terrain.js の expandLanduseGrid / computeLandStats）で求める。
// 呼び出しは、terrain.js・items.js が読み込まれた後（items.js の末尾）。
function fetchPrefLandStats(code){
  const nn = String(code).padStart(2, '0');
  return fetch('data/pref' + nn + '/data_mesh.js').then(r => { if(!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }).then(text => {
    const d = new Function(text + '\n;return { runs: MESH_RUNS_FLAT, order: LANDUSE_ORDER, cellLat: MESH_CELL_LAT_DEG, cellLon: MESH_CELL_LON_DEG };')();
    return computeLandStats(expandLanduseGrid(d.runs, d.order, d.cellLat, d.cellLon), d.order);
  });
}
function printParamsTable(){
  const codes = (typeof AVAILABLE_PREFECTURE_CODES !== 'undefined') ? AVAILABLE_PREFECTURE_CODES : [];
  return Promise.all(codes.map(code => fetchPrefLandStats(code).catch(e => { console.warn('[params] 県' + code + ' の地形統計を計算できません: ' + e); return null; }))).then(statsList => {
    const rows = [];
    codes.forEach((code, i) => {
      const st = statsList[i];
      Object.keys(CONFIG.DIFFICULTY).forEach(key => {
        const d = CONFIG.DIFFICULTY[key], r = chestCountRange(d), sc = itemScaleFor(d);
        rows.push({ '県コード': code, '難易度': key, 'spawnMaxKm': d.spawnMaxKm, '宝箱数の基準値': r.base, '宝箱数の範囲(min-max)': r.min + '-' + r.max,
                    '時間アイテム秒数': timeItemSecFor(sc), 'スピード効果時間(秒)': Math.round(speedBoostSecFor(sc) * 10) / 10,
                    '森林率+河川率': st ? Math.round(st.forestRiverRatio * 1000) / 1000 : '-', '陸地面積km2': st ? Math.round(st.landAreaKm2) : '-',
                    'グライダー可否': st ? (st.forestRiverRatio >= CONFIG.GLIDER_MIN_FOREST_RATIO ? '可' : '不可') : '-', '車可否': st ? (st.landAreaKm2 >= CONFIG.CAR_MIN_AREA_KM2 ? '可' : '不可') : '-' });
      });
    });
    console.table(rows);
  });
}
// （?debug=params の呼び出しは items.js の末尾）

// ==== デバッグ：?debug=daily で、指定日（?date=YYYYMMDD。省略時は今日のJST）のデイリーの県・難易度・宝箱数・各宝箱の中身を console.table で出す（通常起動では何も出さない） ====
// ゲーム内と同じ関数（computeDailyPlan・dailyChestCount・buildDailyLoot・生成用ストリーム loot）で求めるので、同じ日はゲーム内の宝箱の中身（番号順）と一致する。呼び出しは items.js の末尾
function printDailyTable(){
  const date = dailyDateFromUrl(dailyParams);
  const plan = computeDailyPlan(date, dailyAvailableCodes());
  if(plan.pref === null){ console.warn('[daily] 利用できる県がありません'); return Promise.resolve(); }
  return fetchPrefLandStats(plan.pref).then(stats => {
    const diff = CONFIG.DIFFICULTY[plan.diffKey], n = dailyChestCount(diff);
    const loot = buildDailyLoot(n, dailyStream(plan, 'loot'), stats);
    const rows = loot.map((it, i) => ({ '日付': date, '県コード': plan.pref, '難易度': plan.diffKey, '宝箱数': n, '宝箱番号': i + 1, '中身': it }));
    console.table(rows);
  });
}
