// ======================================================================
// terrain.js
// 地形の判定・描画：isPassable / getLanduseCode / 地形の速度倍率に使う土地利用コード / テクスチャ関連
// ======================================================================

const TEXTURE_TILE_CELLS = 3; // 128pxのテクスチャ1枚を何メッシュセル分（何百m四方）として敷くか
let PATTERN_BUILDING = null, PATTERN_WATER = null, PATTERN_FOREST = null;
let PATTERN_RICEFIELD = null, PATTERN_VEGGARDEN = null, PATTERN_WASTELAND = null,
    PATTERN_GOLF = null, PATTERN_BEACH = null;
let PATTERN_FACTORY = null, PATTERN_HOUSE = null, PATTERN_HOUSES = null, PATTERN_PARK = null;
const TEXTURE_IMAGES = Object.create(null);
let textureLoadFinished = 0;
const TEXTURE_IMAGE_COUNT = 12;
function loadTexture(src, setPattern){
  const img = new Image();
  img.onload = ()=>{
    TEXTURE_IMAGES[src] = img;
    textureLoadFinished++;
    try {
      const pattern = ctx.createPattern(img, 'repeat');
      // 128px（テクスチャの元解像度）＝ TEXTURE_TILE_CELLS セル分のワールドpxにスケールする
      // （引き伸ばし拡大を避けるため、セルの実サイズに合わせて縮小方向にスケールする）
      const scaleX = (TEXTURE_TILE_CELLS * MESH_CELL_LON_DEG * PX_PER_DEG_LON) / img.naturalWidth;
      const scaleY = (TEXTURE_TILE_CELLS * MESH_CELL_LAT_DEG * PX_PER_DEG_LAT) / img.naturalHeight;
      pattern.setTransform(new DOMMatrix([scaleX, 0, 0, scaleY, 0, 0]));
      setPattern(pattern);
    } catch(e){ /* createPattern失敗時は何もしない＝下地のラスター単色のまま表示される */ }
    tryBuildTexturedLanduseRaster();
  };
  img.onerror = ()=>{
    textureLoadFinished++;
    tryBuildTexturedLanduseRaster();
  };
  img.src = src;
}
// 12種のテクスチャ画像の読み込みを開始する（initTerrain()から1回だけ呼ぶ）。
// onload内でMESH_CELL_LON_DEG・PX_PER_DEG_LON等（県データ読み込み後に確定する値）を使うため、
// 県データの読み込み完了後に始める。
function startTextureLoads(){
  loadTexture('assets/building.webp', p=>{ PATTERN_BUILDING = p; });
  loadTexture('assets/water.webp', p=>{ PATTERN_WATER = p; });
  loadTexture('assets/forest.webp', p=>{ PATTERN_FOREST = p; });
  loadTexture('assets/ricefield.webp', p=>{ PATTERN_RICEFIELD = p; });
  loadTexture('assets/vegetablegarden.webp', p=>{ PATTERN_VEGGARDEN = p; });
  loadTexture('assets/wasteland.webp', p=>{ PATTERN_WASTELAND = p; });
  loadTexture('assets/golf.webp', p=>{ PATTERN_GOLF = p; });
  loadTexture('assets/beach.webp', p=>{ PATTERN_BEACH = p; });
  loadTexture('assets/factory.webp', p=>{ PATTERN_FACTORY = p; });
  loadTexture('assets/house.webp', p=>{ PATTERN_HOUSE = p; });
  loadTexture('assets/houses.webp', p=>{ PATTERN_HOUSES = p; });
  loadTexture('assets/park.webp', p=>{ PATTERN_PARK = p; });
}

// 探検家・宝箱オープン演出は、実アルファ入りwebm動画から抽出したフレームを
// 横一列に並べたスプライトシート（本物の透過PNG）として読み込み、Canvas上でコマ送り表示する。
// これにより「透過」と「アニメーション」を両立できる（<img>重ね・mix-blend-modeは不要になった）。
// 新カテゴリ番号（tokyo_landuse_2020_100m_integrated17.json準拠、17分類）
// 1=田, 2=その他の農用地, 3=森林, 4=荒地, 5=高層建物, 6=工場, 7=低層建物, 8=低層建物（密集地）,
// 9=道路, 10=鉄道, 11=公共施設等用地, 12=空地, 13=公園・緑地, 14=河川地及び湖沼, 15=海浜, 16=海水域, 17=ゴルフ場
const LANDUSE_RICE = '1', LANDUSE_OTHER_AGRI = '2', LANDUSE_FOREST = '3', LANDUSE_WASTELAND = '4',
      LANDUSE_HIGHRISE = '5', LANDUSE_FACTORY = '6', LANDUSE_LOWRISE = '7', LANDUSE_LOWRISE_DENSE = '8',
      LANDUSE_ROAD = '9', LANDUSE_RAIL = '10', LANDUSE_PUBLIC = '11', LANDUSE_VACANT = '12',
      LANDUSE_PARK = '13', LANDUSE_RIVER = '14', LANDUSE_BEACH = '15', LANDUSE_SEA = '16', LANDUSE_GOLF = '17';

// [起点コードからの差分, 土地利用カテゴリのindex(LANDUSE_ORDER), 連続コマ数] の3つ組を繰り返すフラット配列
function latLonToMeshCode(lat, lon){
  const p = Math.floor(lat*60/40);
  const a = lat*60 - p*40;
  const q = Math.floor(lon) - 100;
  const b = lon - (100+q);
  const r = Math.floor(a/5);
  const a2 = a - r*5;
  const c = Math.floor(b/0.125);
  const b2 = b - c*0.125;
  const m = Math.floor(a2/0.5);
  const a3 = a2 - m*0.5;
  const n = Math.floor(b2/0.0125);
  const b3 = b2 - n*0.0125;
  const m2 = Math.floor(a3/0.05);
  const n2 = Math.floor(b3/0.00125);
  // 10桁ぶんゼロ埋めして数値化（各桁の桁上がりを正しく保つため文字列経由）
  const s = String(p).padStart(2,'0') + String(q).padStart(2,'0') + r + c + m + n + m2 + n2;
  return Number(s);
}
// メッシュコード（10桁）→ そのメッシュの南西端の緯度経度（ラスター事前描画用）
function meshCodeToSWLatLon(code){
  const s = String(code).padStart(10,'0');
  const p=+s.slice(0,2), q=+s.slice(2,4), r=+s[4], c=+s[5], m=+s[6], n=+s[7], m2=+s[8], n2=+s[9];
  const a = r*5 + m*0.5 + m2*0.05;
  const lat = p*(40/60) + a/60;
  const b = c*0.125 + n*0.0125 + n2*0.00125;
  const lon = 100 + q + b;
  return [lat, lon];
}

// ゲーム起動時に1回だけRLEを展開し、メッシュコード→土地利用indexのMapを作る（毎フレーム展開はしない）
const meshLookup = new Map();
function buildMeshLookup(){
  let prevEnd = null;
  for(let i=0; i<MESH_RUNS_FLAT.length; i+=3){
    const delta = MESH_RUNS_FLAT[i], idx = MESH_RUNS_FLAT[i+1], len = MESH_RUNS_FLAT[i+2];
    const start = (prevEnd===null) ? delta : prevEnd + delta;
    for(let k=0;k<len;k++){ meshLookup.set(start+k, idx); }
    prevEnd = start + len;
  }
}

function getLanduseCode(lat, lon){
  const idx = meshLookup.get(latLonToMeshCode(lat, lon));
  return (idx===undefined) ? null : LANDUSE_ORDER[idx]; // null＝データ範囲外
}
// 通行可否：海・海浜のみ進入不可（行き止まり）。河川・湖沼は通行可能（ただし速度側で大幅減速、update()参照）。
function isPassable(lat, lon){
  const code = getLanduseCode(lat, lon);
  if(code === null) return true; // データ範囲外（隣接県など）は通行可能扱い
  if(code === LANDUSE_SEA || code === LANDUSE_BEACH) return false;
  return true;
}

// ==== 東京都以外の都道府県（背景用・簡略化ポリゴン, dataofjapan/land由来） ====
// 各要素は [lon,lat,lon,lat,...] のフラット配列（穴なし・単純な輪郭のみ、地名等の装飾なし）
const LANDUSE_RASTER_SCALE = 0.4; // ワールド座標に対する縮小率（画質より起動時間・メモリを優先）
let landuseRasterCanvas = null, landuseRasterOriginX = 0, landuseRasterOriginY = 0;
function buildLanduseRaster(){
  const originX = worldX(lonMin), originY = worldY(latMax); // 東京都bboxの左上（余白なし）
  const endX = worldX(lonMax), endY = worldY(latMin);
  const w = Math.ceil((endX-originX) * LANDUSE_RASTER_SCALE) + 2;
  const h = Math.ceil((endY-originY) * LANDUSE_RASTER_SCALE) + 2;
  const rc = document.createElement('canvas');
  rc.width = w; rc.height = h;
  const rctx = rc.getContext('2d');
  const cellWpx = Math.ceil(MESH_CELL_LON_DEG * PX_PER_DEG_LON * LANDUSE_RASTER_SCALE) + 1;
  const cellHpx = Math.ceil(MESH_CELL_LAT_DEG * PX_PER_DEG_LAT * LANDUSE_RASTER_SCALE) + 1;
  meshLookup.forEach((landuseIdx, meshCode)=>{
    const [swLat, swLon] = meshCodeToSWLatLon(meshCode);
    const cLat = swLat + MESH_CELL_LAT_DEG/2, cLon = swLon + MESH_CELL_LON_DEG/2;
    const wx = worldX(cLon), wy = worldY(cLat);
    const rx = (wx - originX) * LANDUSE_RASTER_SCALE;
    const ry = (wy - originY) * LANDUSE_RASTER_SCALE;
    rctx.fillStyle = LANDUSE_COLORS[LANDUSE_ORDER[landuseIdx]] || '#3f6b45';
    rctx.fillRect(rx - cellWpx/2, ry - cellHpx/2, cellWpx, cellHpx);
  });
  landuseRasterCanvas = rc;
  landuseRasterOriginX = originX; landuseRasterOriginY = originY;
}

// テクスチャ用の軽量グリッド（起動時に1回だけ構築）：行・列の整数インデックスで即座に引けるようにし、
// 毎フレームの描画ループで文字列ベースのメッシュコード計算をしないようにするための最適化。
// 当たり判定側（isPassable/getLanduseCode）はこれまで通りmeshLookupを直接使うので、判定ロジックには一切影響しない。
let textureGrid = null, textureGridCols = 0, textureGridRows = 0;
let TEXTURE_GRID_LON0 = 0, TEXTURE_GRID_LAT0 = 0; // initTerrain()で lonMin / latMin を入れる
function buildTextureGrid(){
  textureGridCols = Math.ceil((lonMax - lonMin) / MESH_CELL_LON_DEG) + 2;
  textureGridRows = Math.ceil((latMax - latMin) / MESH_CELL_LAT_DEG) + 2;
  // 0=対象外, 1=高層建物, 2=工場, 3=低層建物, 4=低層建物(密集地), 5=河川湖沼, 6=森林,
  // 7=田, 8=その他農地, 9=荒地, 10=ゴルフ場, 11=海浜, 12=公園緑地
  textureGrid = new Uint8Array(textureGridCols * textureGridRows);
  meshLookup.forEach((landuseIdx, meshCode)=>{
    const code = LANDUSE_ORDER[landuseIdx];
    let v = 0;
    if(code === LANDUSE_HIGHRISE) v = 1;
    else if(code === LANDUSE_FACTORY) v = 2;
    else if(code === LANDUSE_LOWRISE) v = 3;
    else if(code === LANDUSE_LOWRISE_DENSE) v = 4;
    else if(code === LANDUSE_RIVER) v = 5;
    else if(code === LANDUSE_FOREST) v = 6;
    else if(code === LANDUSE_RICE) v = 7;
    else if(code === LANDUSE_OTHER_AGRI) v = 8;
    else if(code === LANDUSE_WASTELAND) v = 9;
    else if(code === LANDUSE_GOLF) v = 10;
    else if(code === LANDUSE_BEACH) v = 11;
    else if(code === LANDUSE_PARK) v = 12;
    if(v === 0) return;
    const [swLat, swLon] = meshCodeToSWLatLon(meshCode);
    const col = Math.round((swLon - TEXTURE_GRID_LON0) / MESH_CELL_LON_DEG);
    const row = Math.round((swLat - TEXTURE_GRID_LAT0) / MESH_CELL_LAT_DEG);
    if(col >= 0 && col < textureGridCols && row >= 0 && row < textureGridRows){
      textureGrid[row*textureGridCols + col] = v;
    }
  });
}

// ==== テクスチャ付き土地利用ラスターを起動時に一度だけ焼き付ける ==== 
// 元の土地利用ラスターを下地にコピーし、対応カテゴリだけテクスチャを重ねる。
// 以後の毎フレーム処理は main.js の drawImage だけになる。
const TEXTURED_LANDUSE_RASTER_SCALE = 1.0;
let texturedLanduseRasterCanvas = null;
let texturedLanduseRasterOriginX = 0, texturedLanduseRasterOriginY = 0;
let texturedLanduseRasterBuildStarted = false;
function tryBuildTexturedLanduseRaster(){
  if(texturedLanduseRasterBuildStarted || textureLoadFinished < TEXTURE_IMAGE_COUNT) return;
  if(!landuseRasterCanvas || !meshLookup || !LANDUSE_ORDER) return;
  texturedLanduseRasterBuildStarted = true;
  try {
    const rc = document.createElement('canvas');
    rc.width = Math.ceil(landuseRasterCanvas.width / LANDUSE_RASTER_SCALE);
    rc.height = Math.ceil(landuseRasterCanvas.height / LANDUSE_RASTER_SCALE);
    const rctx = rc.getContext('2d');
    // 画像未読込・読込失敗カテゴリがあっても、単色の土地利用地図を維持する。
    rctx.drawImage(
    landuseRasterCanvas,
    0,
    0,
    landuseRasterCanvas.width / LANDUSE_RASTER_SCALE,
    landuseRasterCanvas.height / LANDUSE_RASTER_SCALE
    );

    const patternForFile = Object.create(null);
    for(const src of [
      'assets/building.webp', 'assets/factory.webp', 'assets/house.webp', 'assets/houses.webp', 'assets/water.webp',
      'assets/forest.webp', 'assets/ricefield.webp', 'assets/vegetablegarden.webp', 'assets/wasteland.webp',
      'assets/golf.webp', 'assets/beach.webp', 'assets/park.webp'
    ]){
      const img = TEXTURE_IMAGES[src];
      if(!img || !img.naturalWidth || !img.naturalHeight) continue;
      const pattern = rctx.createPattern(img, 'repeat');
      if(!pattern) continue;
      const sx = (TEXTURE_TILE_CELLS * MESH_CELL_LON_DEG * PX_PER_DEG_LON * TEXTURED_LANDUSE_RASTER_SCALE) / img.naturalWidth;
      const sy = (TEXTURE_TILE_CELLS * MESH_CELL_LAT_DEG * PX_PER_DEG_LAT * TEXTURED_LANDUSE_RASTER_SCALE) / img.naturalHeight;
      pattern.setTransform(new DOMMatrix([sx, 0, 0, sy, 0, 0]));
      patternForFile[src] = pattern;
    }
    const fileForCode = Object.create(null);
    fileForCode[LANDUSE_HIGHRISE] = 'assets/building.webp';
    fileForCode[LANDUSE_FACTORY] = 'assets/factory.webp';
    fileForCode[LANDUSE_LOWRISE] = 'assets/house.webp';
    fileForCode[LANDUSE_LOWRISE_DENSE] = 'assets/houses.webp';
    fileForCode[LANDUSE_RIVER] = 'assets/water.webp';
    fileForCode[LANDUSE_FOREST] = 'assets/forest.webp';
    fileForCode[LANDUSE_RICE] = 'assets/ricefield.webp';
    fileForCode[LANDUSE_OTHER_AGRI] = 'assets/vegetablegarden.webp';
    fileForCode[LANDUSE_WASTELAND] = 'assets/wasteland.webp';
    fileForCode[LANDUSE_GOLF] = 'assets/golf.webp';
    fileForCode[LANDUSE_BEACH] = 'assets/beach.webp';
    fileForCode[LANDUSE_PARK] = 'assets/park.webp';

    const originX = landuseRasterOriginX, originY = landuseRasterOriginY;
    const cellWpx = Math.ceil(MESH_CELL_LON_DEG * PX_PER_DEG_LON * TEXTURED_LANDUSE_RASTER_SCALE) + 1;
    const cellHpx = Math.ceil(MESH_CELL_LAT_DEG * PX_PER_DEG_LAT * TEXTURED_LANDUSE_RASTER_SCALE) + 1;
    meshLookup.forEach((landuseIdx, meshCode)=>{
      const code = LANDUSE_ORDER[landuseIdx];
      const file = fileForCode[code];
      const pattern = file && patternForFile[file];
      if(!pattern) return;
      const [swLat, swLon] = meshCodeToSWLatLon(meshCode);
      const wx = worldX(swLon + MESH_CELL_LON_DEG / 2);
      const wy = worldY(swLat + MESH_CELL_LAT_DEG / 2);
      const rx = (wx - originX) * TEXTURED_LANDUSE_RASTER_SCALE;
      const ry = (wy - originY) * TEXTURED_LANDUSE_RASTER_SCALE;
      rctx.fillStyle = pattern;
      rctx.fillRect(rx - cellWpx/2, ry - cellHpx/2, cellWpx, cellHpx);
    });
    texturedLanduseRasterCanvas = rc;
    texturedLanduseRasterOriginX = originX;
    texturedLanduseRasterOriginY = originY;
  } catch(e){
    // 失敗した場合はnullのままにして、main.js側で通常ラスターへフォールバックする。
    texturedLanduseRasterCanvas = null;
  }
}


// ==== 鉄道路線の描画（rail_data.js の RAIL_ROUTES を使用） ====
// 路線はプレイヤー位置に関わらず変化しない静的情報なので、起動時に1回だけオフスクリーンcanvasへ描画し、
// 毎フレームはそのcanvasをdrawImageで貼るだけにする（buildLanduseRasterと同じ考え方）。
// 事業者種別(operatorType)：1=新幹線, 2=JR在来線, 3=公営鉄道, 4=民営鉄道, 5=第三セクター
// （国土数値情報 N02 の値をこのデータで実際に確認済み。3〜5はすべて「私鉄」として扱う＝地下鉄含む）
const RAIL_OPERATOR_SHINKANSEN = 1, RAIL_OPERATOR_JR = 2; // 3,4,5はまとめて私鉄

const RAIL_RASTER_SCALE = 0.5; // ワールド座標に対する縮小率（線の描画なのでlanduseラスターより高めでも軽い）
// 種別ごとの色・太さ（太さはワールドpx基準。ラスターへ描くときはRAIL_RASTER_SCALEを掛けて縮小する）
const RAIL_STYLE = {
  shinkansen: { color: '#ff3b30', width: 5 }, // 新幹線：太め、目立つ色
  jr:         { color: '#0f7a3d', width: 3 }, // JR在来線：中間の太さ、JRらしい緑
  private:    { color: '#8e5bc9', width: 2 }, // 私鉄（公営・民営・第三セクター、地下鉄含む）：やや細め、別の色
};

let railCanvas = null, railCanvasOriginX = 0, railCanvasOriginY = 0;
function buildRailCanvas(){
  if(typeof RAIL_ROUTES === 'undefined') return; // rail_data.js が読み込まれていない場合は何もしない

  // 路線を3種類に分類
  const byType = { shinkansen: [], jr: [], private: [] };
  for(const route of RAIL_ROUTES){
    if(route.operatorType === RAIL_OPERATOR_SHINKANSEN) byType.shinkansen.push(route);
    else if(route.operatorType === RAIL_OPERATOR_JR) byType.jr.push(route);
    else byType.private.push(route); // 3(公営)/4(民営)/5(第三セクター) はすべて私鉄扱い（地下鉄含む）

  }

  // 東京都のワールド座標bbox（landuseラスターと同じ範囲）にオフスクリーンcanvasを用意
  const originX = worldMinX, originY = worldMinY;
  const w = Math.ceil(WORLD_W * RAIL_RASTER_SCALE) + 2;
  const h = Math.ceil(WORLD_H * RAIL_RASTER_SCALE) + 2;
  const rc = document.createElement('canvas');
  rc.width = w; rc.height = h;
  const rctx = rc.getContext('2d');
  rctx.lineCap = 'round';
  rctx.lineJoin = 'round';

  function drawRoutes(routes, style){
    rctx.strokeStyle = style.color;
    rctx.lineWidth = Math.max(1, style.width * RAIL_RASTER_SCALE);
    for(const route of routes){
      const coords = route.coords;
      if(!coords || coords.length < 2) continue;
      rctx.beginPath();
      for(let i=0; i<coords.length; i++){
        const lat = coords[i][0], lon = coords[i][1]; // rail_data.jsの座標は[lat,lon]の順
        const rx = (worldX(lon) - originX) * RAIL_RASTER_SCALE;
        const ry = (worldY(lat) - originY) * RAIL_RASTER_SCALE;
        if(i===0) rctx.moveTo(rx, ry); else rctx.lineTo(rx, ry);
      }
      rctx.stroke();
    }
  }
  // 重ね順：私鉄→JR在来線→新幹線の順に描き、主要な路線ほど上に来るようにする
  drawRoutes(byType.private, RAIL_STYLE.private);
  drawRoutes(byType.jr, RAIL_STYLE.jr);
  drawRoutes(byType.shinkansen, RAIL_STYLE.shinkansen);

  railCanvas = rc;
  railCanvasOriginX = originX; railCanvasOriginY = originY;
}


// ==== 河川の描画（river_data.js の riverData を使用） ====
// 鉄道と全く同じ考え方：プレイヤー位置に関わらず変化しない静的情報なので、起動時に1回だけ
// オフスクリーンcanvasへ描画し、毎フレームはそのcanvasをdrawImageで貼るだけにする。
// 色は、地形テクスチャの水面（PATTERN_WATER）や各RAIL_STYLEの色と衝突しないよう、
// 白に近い薄い水色（#cdeef7）を採用した。太さはJR在来線(3)よりやや細い2.5。
const RIVER_STYLE = { color: '#33CCFF', width: 2.5 };
const RIVER_RASTER_SCALE = 0.5; // 鉄道と同じ縮小率

let riverCanvas = null, riverCanvasOriginX = 0, riverCanvasOriginY = 0;
function buildRiverCanvas(){
  if(typeof riverData === 'undefined') return; // river_data.js が読み込まれていない場合は何もしない

  // 東京都のワールド座標bbox（鉄道ラスターと同じ範囲・同じ原点）にオフスクリーンcanvasを用意
  const originX = worldMinX, originY = worldMinY;
  const w = Math.ceil(WORLD_W * RIVER_RASTER_SCALE) + 2;
  const h = Math.ceil(WORLD_H * RIVER_RASTER_SCALE) + 2;
  const rc = document.createElement('canvas');
  rc.width = w; rc.height = h;
  const rctx = rc.getContext('2d');
  rctx.lineCap = 'round';
  rctx.lineJoin = 'round';
  rctx.strokeStyle = RIVER_STYLE.color;
  rctx.lineWidth = Math.max(1, RIVER_STYLE.width * RIVER_RASTER_SCALE);

  for(const river of riverData){
    const coords = river.coords;
    if(!coords || coords.length < 2) continue;
    rctx.beginPath();
    for(let i=0; i<coords.length; i++){
      const lat = coords[i][0], lon = coords[i][1]; // river_data.jsの座標は[lat,lon]の順（鉄道データと同じ）
      const rx = (worldX(lon) - originX) * RIVER_RASTER_SCALE;
      const ry = (worldY(lat) - originY) * RIVER_RASTER_SCALE;
      if(i===0) rctx.moveTo(rx, ry); else rctx.lineTo(rx, ry);
    }
    rctx.stroke();
  }

  riverCanvas = rc;
  riverCanvasOriginX = originX; riverCanvasOriginY = originY;
}


// ======================================================================
// 地形まわりの初期化（県データ読み込み完了後に、main.jsのstartGame()から1回だけ呼ばれる）
// 以前はこのファイルを読み込んだ瞬間にトップレベルで実行していた処理を、順序そのままで関数にまとめたもの。
// 前提：data/pref<コード>/ の3ファイルが読み込み済み、かつsetupWorldCoordinates()が実行済み。
// ======================================================================
function initTerrain(){
  buildMeshLookup();                // メッシュコード→土地利用indexのMap（RLE展開）
  buildLanduseRaster();             // 単色の土地利用ラスター
  TEXTURE_GRID_LON0 = lonMin; TEXTURE_GRID_LAT0 = latMin;
  buildTextureGrid();               // テクスチャ用の軽量グリッド
  startTextureLoads();              // テクスチャ画像の読み込み開始（全部そろったらonload側で焼き込み）
  tryBuildTexturedLanduseRaster();  // すでに揃っていれば（キャッシュ等）ここで焼き込み
  buildRailCanvas();                // 鉄道canvas
  buildRiverCanvas();               // 河川canvas
}
