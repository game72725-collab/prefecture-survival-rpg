// ======================================================================
// terrain.js
// 地形の判定・描画：isPassable / getLanduseCode / 地形の速度倍率に使う土地利用コード / テクスチャ関連
// ======================================================================

const TEXTURE_TILE_CELLS = 3; // 128pxのテクスチャ1枚を何メッシュセル分（何百m四方）として敷くか
const TEXTURE_IMAGES = Object.create(null);
let textureLoadFinished = 0;
const TEXTURE_IMAGE_COUNT = 12;
// テクスチャ画像1枚の読み込み。読み込めたら TEXTURE_IMAGES に入れ、成功・失敗にかかわらず完了数を数える。
// 12枚すべてが出そろったら、地形タイル用のパターンを作る（tileOnTexturesProgress）。
function loadTexture(src){
  const img = new Image();
  img.onload = ()=>{
    TEXTURE_IMAGES[src] = img;
    textureLoadFinished++;
    tileOnTexturesProgress();
  };
  img.onerror = ()=>{
    textureLoadFinished++;
    tileOnTexturesProgress();
  };
  img.src = src;
}
// 12種のテクスチャ画像の読み込みを開始する（initTerrain()から1回だけ呼ぶ）。
// onload内でMESH_CELL_LON_DEG・PX_PER_DEG_LON等（県データ読み込み後に確定する値）を使うため、
// 県データの読み込み完了後に始める。
function startTextureLoads(){
  ['building', 'water', 'forest', 'ricefield', 'vegetablegarden', 'wasteland', 'golf', 'beach', 'factory', 'house', 'houses', 'park']
    .forEach(name => loadTexture('assets/' + name + '.webp'));
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

// ==== 土地利用メッシュ格子（landuseGrid） ====
// 県データの MESH_RUNS_FLAT（ランレングス）を、起動時に1回だけ Uint8Array の格子へ直接展開する（Mapは使わない）。
//   landuseGrid = { data, cols, rows, row0, col0, originLat, originLon, cellLatDeg, cellLonDeg }
//   data[(row-row0)*cols + (col-col0)] ：0＝データなし（従来の「Mapに無い」＝データ範囲外と同じ扱い）、1〜＝ LANDUSE_ORDER のindex+1（この県データでは土地利用カテゴリ番号1〜17そのもの）
//   row / col：100mメッシュの「全国通しの格子番号」。メッシュコードの桁から求める：
//       row = ((p*8 + r)*10 + m)*10 + m2   （p=1次メッシュ緯度, r=2次, m=3次, m2=4次。南が小さく北が大きい）
//       col = ((q*8 + c)*10 + n)*10 + n2   （q=1次メッシュ経度, c=2次, n=3次, n2=4次。西が小さく東が大きい）
//   row0 / col0：格子の南西端のセルの row / col。originLat / originLon：そのセルの南西端の緯度経度（meshCodeToSWLatLon）
//   範囲（row0, col0, rows, cols）は読み込んだデータの全マスから算出する（特定の県の値は埋め込まない）。
let landuseGrid = null;

let _mRow = 0, _mCol = 0; // decodeMeshCode の結果（アロケーションを避けるためモジュール変数で返す）
// 10桁のメッシュコード → 格子番号（_mRow, _mCol）。コードとして成り立たない場合は false。
// （r, c は 0〜7。従来のMapにはそのようなキーが存在しなかったので、検索結果は「データなし」になる）
// コードは10桁（最大約5×10^9）で整数32bitに収まらないため、上5桁(hi)と下5桁(lo)に分けて、以降は小さな整数だけで計算する（高速化）。
function decodeMeshCode(code){
  if(!(code >= 0 && code < 1e10)) return false; // NaN・負数・11桁以上（latLonToMeshCodeの桁あふれ）は範囲外
  const hi = Math.floor(code / 100000), lo = code - hi * 100000; // hi = 上位5桁（p, q, r）、lo = 下位5桁（c, m, n, m2, n2）
  const r = hi % 10, q = ((hi / 10) | 0) % 100, p = (hi / 1000) | 0;
  const c = (lo / 10000) | 0, m = ((lo / 1000) | 0) % 10, n = ((lo / 100) | 0) % 10, m2 = ((lo / 10) | 0) % 10, n2 = lo % 10;
  if(r > 7 || c > 7) return false;
  _mRow = (p*8 + r)*100 + m*10 + m2;
  _mCol = (q*8 + c)*100 + n*10 + n2;
  return true;
}
// 格子番号 → 10桁のメッシュコード（decodeMeshCode の逆）
function meshCodeFromRowCol(row, col){
  const m2 = row % 10, t = Math.floor(row / 10), m = t % 10, t2 = Math.floor(t / 10), r = t2 % 8, p = Math.floor(t2 / 8);
  const n2 = col % 10, u = Math.floor(col / 10), n = u % 10, u2 = Math.floor(u / 10), c = u2 % 8, q = Math.floor(u2 / 8);
  return p*1e8 + q*1e6 + r*1e5 + c*1e4 + m*1e3 + n*100 + m2*10 + n2;
}

// ゲーム起動時（initTerrain）に1回だけ、MESH_RUNS_FLAT を landuseGrid に展開する。毎回新しく作り直し、前の県の格子は引きずらない。
// 展開が終わったら MESH_RUNS_FLAT への参照を切る（nullを代入）ので、他の処理はこの関数の後に MESH_RUNS_FLAT を使ってはいけない。
// 高速化のため、各区間は「開始コードを1回だけ桁に分解し、あとは +1 を桁上がりつきで進める」方式で展開する
// （結果は start+k を毎回分解するのと同じ。桁カウンタはローカル変数にして速くしている）。
function buildLanduseGrid(){
  landuseGrid = null;
  const runs = MESH_RUNS_FLAT;
  if(!runs || runs.length < 3) throw new Error('土地利用メッシュのデータ（MESH_RUNS_FLAT）が空です');
  if(LANDUSE_ORDER.length > 254) throw new Error('土地利用カテゴリが多すぎます（254まで）');
  let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity, invalid = 0, ascending = true;
  let cols = 0, data = null;
  // pass 0：全マスの格子番号の最小・最大を求める（メッシュコードは row/col の単調な関数ではないので、コードの最小・最大ではなく row/col で範囲を決める）
  // pass 1：値を書き込む（同じマスが複数回出てきたら、Mapと同じく後のものが勝つ）
  for(let pass = 0; pass < 2; pass++){
    let prevEnd = null;
    for(let i = 0; i < runs.length; i += 3){
      if(pass === 0 && i > 0 && runs[i] < 0) ascending = false;
      const start = (prevEnd === null) ? runs[i] : prevEnd + runs[i], len = runs[i+2], v = runs[i+1] + 1;
      prevEnd = start + len;
      if(!(start >= 0 && start < 1e10)){ if(pass === 0) invalid += len; continue; }
      const hi = Math.floor(start / 100000), lo = start - hi * 100000;
      let dr = hi % 10, dq = ((hi / 10) | 0) % 100, dp = (hi / 1000) | 0;
      let dc = (lo / 10000) | 0, dm = ((lo / 1000) | 0) % 10, dn = ((lo / 100) | 0) % 10, dm2 = ((lo / 10) | 0) % 10, dn2 = lo % 10;
      for(let k = 0; k < len; k++){
        if(dp < 100 && dr <= 7 && dc <= 7){
          const row = (dp*8 + dr)*100 + dm*10 + dm2, col = (dq*8 + dc)*100 + dn*10 + dn2;
          if(pass === 0){
            if(row < minRow) minRow = row; if(row > maxRow) maxRow = row;
            if(col < minCol) minCol = col; if(col > maxCol) maxCol = col;
          } else {
            data[(row - minRow) * cols + (col - minCol)] = v;
          }
        } else if(pass === 0) invalid++;
        // コード+1（十進の桁上がり）
        if(++dn2 === 10){ dn2 = 0; if(++dm2 === 10){ dm2 = 0; if(++dn === 10){ dn = 0; if(++dm === 10){ dm = 0;
          if(++dc === 10){ dc = 0; if(++dr === 10){ dr = 0; if(++dq === 100){ dq = 0; dp++; } } } } } } }
      }
    }
    if(pass === 0){
      if(invalid) console.warn('[landuseGrid] メッシュコードとして成り立たないマスを ' + invalid + ' 件スキップしました');
      if(!ascending) console.warn('[landuseGrid] ランレングスが昇順ではありません。単色ラスター等の描画順が従来と変わる可能性があります');
      if(minRow === Infinity) throw new Error('有効な土地利用メッシュがありません');
      cols = maxCol - minCol + 1;
      const rows = maxRow - minRow + 1;
      if(cols * rows > 4e8) throw new Error('土地利用格子が大きすぎます（' + cols + '×' + rows + '）。データの範囲を確認してください');
      data = new Uint8Array(cols * rows);
    }
  }
  const sw = meshCodeToSWLatLon(meshCodeFromRowCol(minRow, minCol));
  landuseGrid = { data, cols, rows: maxRow - minRow + 1, row0: minRow, col0: minCol, originLat: sw[0], originLon: sw[1],
                  cellLatDeg: MESH_CELL_LAT_DEG, cellLonDeg: MESH_CELL_LON_DEG };
  MESH_RUNS_FLAT = null; // 展開用の元データは不要になったので参照を切る（メモリ解放）
}

// メッシュコード → 格子の値（0＝データなし）
function landuseGridValue(code){
  const g = landuseGrid;
  if(!g || !decodeMeshCode(code)) return 0;
  const row = _mRow - g.row0, col = _mCol - g.col0;
  if(row < 0 || row >= g.rows || col < 0 || col >= g.cols) return 0;
  return g.data[row * g.cols + col];
}

// 格子のうち、全国通しの格子番号が [wRowMin..wRowMax]×[wColMin..wColMax] の範囲にあるマスだけを、メッシュコードの昇順
// （＝従来のMapの挿入順＝ランレングスの順）で fn(meshCode, v) に渡す。v は 1〜（LANDUSE_ORDER の index+1）。
// 呼ばれる直前に、そのマスの南西端の緯度経度を _cellLat / _cellLon に入れる（meshCodeToSWLatLon と同じ式。文字列変換を避ける高速化）。
// 土地利用の描画は、重なり部分の塗り順で見た目が変わるため、従来と同じ順序（コード昇順）で描く必要がある。
let _cellLat = 0, _cellLon = 0;
function forEachLanduseCellInWindow(wRowMin, wRowMax, wColMin, wColMax, fn){
  const g = landuseGrid;
  if(!g) return;
  const data = g.data, cols = g.cols, row0 = g.row0, col0 = g.col0;
  const rowLo = Math.max(row0, wRowMin), rowHi = Math.min(row0 + g.rows - 1, wRowMax);
  const colLo = Math.max(col0, wColMin), colHi = Math.min(col0 + cols - 1, wColMax);
  if(rowLo > rowHi || colLo > colHi) return;
  const pMin = Math.floor(rowLo / 800), pMax = Math.floor(rowHi / 800);
  const qMin = Math.floor(colLo / 800), qMax = Math.floor(colHi / 800);
  for(let p = pMin; p <= pMax; p++){
    for(let q = qMin; q <= qMax; q++){
      for(let r = 0; r < 8; r++){
        const rowR = (p*8 + r) * 100;
        if(rowR + 99 < rowLo || rowR > rowHi) continue;
        for(let c = 0; c < 8; c++){
          const colC = (q*8 + c) * 100;
          if(colC + 99 < colLo || colC > colHi) continue;
          for(let m = 0; m < 10; m++){
            const rowM = rowR + m*10;
            if(rowM + 9 < rowLo || rowM > rowHi) continue;
            for(let n = 0; n < 10; n++){
              const colN = colC + n*10;
              if(colN + 9 < colLo || colN > colHi) continue;
              for(let m2 = 0; m2 < 10; m2++){
                const row = rowM + m2;
                if(row < rowLo || row > rowHi) continue;
                const aMin = r*5 + m*0.5 + m2*0.05;
                const swLat = p*(40/60) + aMin/60;
                for(let n2 = 0; n2 < 10; n2++){
                  const col = colN + n2;
                  if(col < colLo || col > colHi) continue;
                  const v = data[(row - row0) * cols + (col - col0)];
                  if(v === 0) continue;
                  const b = c*0.125 + n*0.0125 + n2*0.00125;
                  _cellLat = swLat; _cellLon = 100 + q + b;
                  fn(p*1e8 + q*1e6 + r*1e5 + c*1e4 + m*1e3 + n*100 + m2*10 + n2, v);
                }
              }
            }
          }
        }
      }
    }
  }
}
// 格子の全マスを昇順で fn(meshCode, v) に渡す（検証用ツール向けの薄いラッパー）
function forEachLanduseCell(fn){
  const g = landuseGrid;
  if(!g) return;
  forEachLanduseCellInWindow(g.row0, g.row0 + g.rows - 1, g.col0, g.col0 + g.cols - 1, fn);
}

function getLanduseCode(lat, lon){
  const v = landuseGridValue(latLonToMeshCode(lat, lon)); // 緯度経度→メッシュコードは従来と同じ計算（丸め・境界の扱いも同一）
  return (v === 0) ? null : LANDUSE_ORDER[v - 1]; // null＝データ範囲外
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
// ======================================================================
// 地形タイル（小さなcanvasのキャッシュ）
// 以前は県全体を1枚の巨大canvas（単色0.4倍＋テクスチャ焼き込み1.0倍）に起動時に描いていたが、県が大きいとメモリが破綻するため、
// 「画面に映る範囲のタイルだけを、landuseGrid から必要な時に描いてキャッシュする」方式にした。
//   タイル(tx,ty)のワールド範囲 = 原点(県のbbox角) + [tx*T,(tx+1)*T) × [ty*T,(ty+1)*T)    ※T = CONFIG.TILE_WORLD_PX（5の倍数）
//   ① テクスチャタイル：T×T canvas px（1ワールドpx＝1canvas px）。単色の下地の上に、テクスチャのパターンをセルごとに塗ったもの
//   ② 単色タイル：T×0.4 canvas px（0.4倍。旧・単色ラスターと同じ解像度）
// 描画内容は旧ラスターと同じ手順（セルごとのfillRect、重ね代 ceil(幅)+1、丸めなし、コード昇順）を踏襲する。
// ======================================================================
const SOLID_TILE_SCALE = 0.4;   // 単色タイルの解像度（ワールド1pxあたりのcanvas px）
const TEX_TILE_SCALE = 1.0;     // テクスチャタイルの解像度（1ワールドpx＝1canvas px）
const TILE_SCRATCH_MARGIN = 2;  // 単色の下地を2.5倍に拡大する時、タイル境界で旧ラスターと同じ補間になるよう、周囲に付ける余白（単色px）
const TILE_POOL_MAX = 24;       // 再利用待ちのcanvasを何枚まで持つか（種類ごと）。超えた分は width/height=0 で解放する

let tileWorldPx = 200, tileSolidPx = 80, tileTexPx = 200;
let tileOriginX = 0, tileOriginY = 0, tilesX = 0, tilesY = 0;
let texTiles = new Map();    // key(=ty*tilesX+tx) → { cv, last }  テクスチャタイル
let solidTiles = new Map();  // 単色タイル
let tileEmpty = new Set();   // セルが1つも無いタイル（canvasを作らない）
let tilePoolTex = [], tilePoolSolid = []; // 破棄したcanvasの再利用待ち
let tileScratch = null;      // 下地用の作業canvas（単色px (80+2×余白)²）
let tilePatterns = null;     // テクスチャ12種のパターン {画像パス: CanvasPattern}。null＝まだ作っていない
let tileTexturesReady = false; // パターンが1つ以上作れた（＝テクスチャタイルを焼ける）
let tileFrame = 0;           // draw のたびに増える。タイルの「最終使用フレーム」（LRU）に使う
let tileSolidColors = null;  // v(1〜) → 色
let tileFileForCode = null;  // 土地利用カテゴリ → テクスチャ画像パス
const tileStats = { canvasesCreated: 0, texBakes: 0, texBakeMs: 0, texBakeMaxMs: 0, solidBuilds: 0, solidMs: 0, evictionsTex: 0, evictionsSolid: 0, prebakeMs: 0, prebakeTiles: 0 };

function takeTileCanvas(pool, size){
  let cv = pool.pop();
  if(!cv){
    cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    cv._ctx = cv.getContext('2d');
    tileStats.canvasesCreated++;
  } else {
    cv._ctx.setTransform(1, 0, 0, 1, 0, 0);
    cv._ctx.clearRect(0, 0, size, size);
  }
  return cv;
}
function disposeTileCanvas(cv){ cv.width = 0; cv.height = 0; cv._ctx = null; } // width/height=0 でメモリを確実に解放（iOS Safari対策）
function releaseTileCanvas(pool, cv){ if(pool.length < TILE_POOL_MAX) pool.push(cv); else disposeTileCanvas(cv); }

// 県データを読み込み直す時（initTerrain）・終了時：キャッシュ・プール・作業canvasをすべて破棄する
function disposeTerrainTiles(){
  for(const e of texTiles.values()) disposeTileCanvas(e.cv);
  for(const e of solidTiles.values()) disposeTileCanvas(e.cv);
  tilePoolTex.forEach(disposeTileCanvas); tilePoolSolid.forEach(disposeTileCanvas);
  if(tileScratch) disposeTileCanvas(tileScratch);
  texTiles = new Map(); solidTiles = new Map(); tileEmpty = new Set();
  tilePoolTex = []; tilePoolSolid = []; tileScratch = null;
  tilePatterns = null; tileTexturesReady = false; tileFrame = 0;
  for(const k of Object.keys(tileStats)) tileStats[k] = 0;
}

function initTileSystem(){
  tileWorldPx = Math.round((CONFIG.TILE_WORLD_PX || 200) / 5) * 5; // 5の倍数に丸める（単色タイルの解像度0.4倍で整数pxになるため）
  if(!(tileWorldPx >= 5)) tileWorldPx = 200;
  tileSolidPx = Math.round(tileWorldPx * SOLID_TILE_SCALE);
  tileTexPx = Math.round(tileWorldPx * TEX_TILE_SCALE);
  tileOriginX = worldX(lonMin); tileOriginY = worldY(latMax); // 旧ラスターと同じ原点（県のbbox左上、余白なし）
  const endX = worldX(lonMax), endY = worldY(latMin);
  tilesX = Math.ceil((endX - tileOriginX + 5) / tileWorldPx);
  tilesY = Math.ceil((endY - tileOriginY + 5) / tileWorldPx);
  tileScratch = document.createElement('canvas');
  tileScratch.width = tileSolidPx + 2 * TILE_SCRATCH_MARGIN; tileScratch.height = tileScratch.width;
  tileScratch._ctx = tileScratch.getContext('2d');
  tileStats.canvasesCreated++;
  tileSolidColors = [''];
  for(let i = 0; i < LANDUSE_ORDER.length; i++) tileSolidColors.push(LANDUSE_COLORS[LANDUSE_ORDER[i]] || '#3f6b45');
  // 土地利用カテゴリ → テクスチャ画像（旧・焼き込みと同じ対応）
  tileFileForCode = Object.create(null);
  tileFileForCode[LANDUSE_HIGHRISE] = 'assets/building.webp';
  tileFileForCode[LANDUSE_FACTORY] = 'assets/factory.webp';
  tileFileForCode[LANDUSE_LOWRISE] = 'assets/house.webp';
  tileFileForCode[LANDUSE_LOWRISE_DENSE] = 'assets/houses.webp';
  tileFileForCode[LANDUSE_RIVER] = 'assets/water.webp';
  tileFileForCode[LANDUSE_FOREST] = 'assets/forest.webp';
  tileFileForCode[LANDUSE_RICE] = 'assets/ricefield.webp';
  tileFileForCode[LANDUSE_OTHER_AGRI] = 'assets/vegetablegarden.webp';
  tileFileForCode[LANDUSE_WASTELAND] = 'assets/wasteland.webp';
  tileFileForCode[LANDUSE_GOLF] = 'assets/golf.webp';
  tileFileForCode[LANDUSE_BEACH] = 'assets/beach.webp';
  tileFileForCode[LANDUSE_PARK] = 'assets/park.webp';
}

// 12枚の画像がそろったら、テクスチャのパターンを作る（旧・焼き込みと同じ createPattern ＋ setTransform）。
// パターンは作業canvasのctxから作るが、どのタイルのctxでも使える。基準位置は塗る時のctxの座標系（＝translateで固定したワールド座標）。
function tileOnTexturesProgress(){
  if(textureLoadFinished < TEXTURE_IMAGE_COUNT || tilePatterns || !tileScratch) return;
  tilePatterns = Object.create(null);
  let n = 0;
  try {
    for(const src of Object.keys(TEXTURE_IMAGES)){
      const img = TEXTURE_IMAGES[src];
      if(!img || !img.naturalWidth) continue;
      const pattern = tileScratch._ctx.createPattern(img, 'repeat');
      if(!pattern) continue;
      const sx = (TEXTURE_TILE_CELLS * MESH_CELL_LON_DEG * PX_PER_DEG_LON * TEX_TILE_SCALE) / img.naturalWidth;
      const sy = (TEXTURE_TILE_CELLS * MESH_CELL_LAT_DEG * PX_PER_DEG_LAT * TEX_TILE_SCALE) / img.naturalHeight;
      pattern.setTransform(new DOMMatrix([sx, 0, 0, sy, 0, 0]));
      tilePatterns[src] = pattern; n++;
    }
  } catch(e){
    console.warn('[terrain] テクスチャのパターン作成に失敗しました。単色タイルのままにします', e);
    n = 0; tilePatterns = Object.create(null);
  }
  tileTexturesReady = n > 0;
}
function terrainTexturesFinished(){ return textureLoadFinished >= TEXTURE_IMAGE_COUNT; }

// ---- タイルに重なるセルの範囲 ----
// タイルのワールド範囲（＋セル半分＋余白）に中心がある可能性のあるセルの、全国通しの格子番号の範囲（少し広めに取る）。
// セルの描画サイズは ceil(セル幅px×倍率)+1 なので、はみ出す分は余白で拾い、はみ出した部分はcanvasのクリップに任せる。
let _wRowMin = 0, _wRowMax = 0, _wColMin = 0, _wColMax = 0;
function tileCellWindow(tx, ty){
  const cellWorldW = Math.max((Math.ceil(MESH_CELL_LON_DEG * PX_PER_DEG_LON * TEX_TILE_SCALE) + 1) / TEX_TILE_SCALE,
                              (Math.ceil(MESH_CELL_LON_DEG * PX_PER_DEG_LON * SOLID_TILE_SCALE) + 1) / SOLID_TILE_SCALE);
  const cellWorldH = Math.max((Math.ceil(MESH_CELL_LAT_DEG * PX_PER_DEG_LAT * TEX_TILE_SCALE) + 1) / TEX_TILE_SCALE,
                              (Math.ceil(MESH_CELL_LAT_DEG * PX_PER_DEG_LAT * SOLID_TILE_SCALE) + 1) / SOLID_TILE_SCALE);
  const m = TILE_SCRATCH_MARGIN / SOLID_TILE_SCALE; // 下地の余白（ワールドpx）
  const wx0 = tileOriginX + tx * tileWorldPx - m - cellWorldW, wx1 = tileOriginX + (tx + 1) * tileWorldPx + m + cellWorldW;
  const wy0 = tileOriginY + ty * tileWorldPx - m - cellWorldH, wy1 = tileOriginY + (ty + 1) * tileWorldPx + m + cellWorldH;
  const lonA = REF_LON + wx0 / PX_PER_DEG_LON, lonB = REF_LON + wx1 / PX_PER_DEG_LON;
  const latA = REF_LAT - wy1 / PX_PER_DEG_LAT, latB = REF_LAT - wy0 / PX_PER_DEG_LAT; // ワールドYは北が小さい
  _wColMin = Math.floor((lonA - 100) * 800) - 1; _wColMax = Math.floor((lonB - 100) * 800) + 1; // 経度: col = (lon-100)×800
  _wRowMin = Math.floor(latA * 1200) - 1;        _wRowMax = Math.floor(latB * 1200) + 1;        // 緯度: row = lat×1200
}
// タイルの範囲に、セルが1つでもあるか（無ければ canvas を作らない）
function tileHasCells(tx, ty){
  const g = landuseGrid;
  if(!g) return false;
  tileCellWindow(tx, ty);
  const rowLo = Math.max(g.row0, _wRowMin), rowHi = Math.min(g.row0 + g.rows - 1, _wRowMax);
  const colLo = Math.max(g.col0, _wColMin), colHi = Math.min(g.col0 + g.cols - 1, _wColMax);
  for(let row = rowLo; row <= rowHi; row++){
    const base = (row - g.row0) * g.cols - g.col0;
    for(let col = colLo; col <= colHi; col++) if(g.data[base + col] !== 0) return true;
  }
  return false;
}

// ---- 単色セルの描画（従来の単色ラスターと同じ式）----
// c2d の大きさは (N + 2m)² 。ワールド→canvas：x = (wx - 原点X)×0.4 - N×tx + m（整数のtranslateだけでずらす）
function paintSolidCells(c2d, tx, ty, m){
  const S = SOLID_TILE_SCALE;
  const cellWpx = Math.ceil(MESH_CELL_LON_DEG * PX_PER_DEG_LON * S) + 1;
  const cellHpx = Math.ceil(MESH_CELL_LAT_DEG * PX_PER_DEG_LAT * S) + 1;
  c2d.setTransform(1, 0, 0, 1, m - tileSolidPx * tx, m - tileSolidPx * ty);
  tileCellWindow(tx, ty);
  let last = '';
  forEachLanduseCellInWindow(_wRowMin, _wRowMax, _wColMin, _wColMax, (meshCode, v)=>{
    const wx = worldX(_cellLon + MESH_CELL_LON_DEG/2), wy = worldY(_cellLat + MESH_CELL_LAT_DEG/2);
    const rx = (wx - tileOriginX) * S, ry = (wy - tileOriginY) * S;
    const color = tileSolidColors[v];
    if(color !== last){ c2d.fillStyle = color; last = color; }
    c2d.fillRect(rx - cellWpx/2, ry - cellHpx/2, cellWpx, cellHpx);
  });
}

// 単色タイル（80×80）。無ければ同期で作る（軽い）。セルが無いタイルは null。
function getSolidTile(tx, ty, key){
  const e = solidTiles.get(key);
  if(e){ e.last = tileFrame; return e.cv; }
  if(tileEmpty.has(key)) return null;
  if(!tileHasCells(tx, ty)){ tileEmpty.add(key); return null; }
  const t0 = performance.now();
  const cv = takeTileCanvas(tilePoolSolid, tileSolidPx);
  paintSolidCells(cv._ctx, tx, ty, 0);
  solidTiles.set(key, { cv, last: tileFrame });
  evictTiles(solidTiles, tilePoolSolid, CONFIG.TILE_CACHE_MAX_SOLID, 'evictionsSolid');
  tileStats.solidBuilds++; tileStats.solidMs += performance.now() - t0;
  return cv;
}

// テクスチャタイル（200×200）を焼く。従来のテクスチャ焼き込みと同じ手順：
//   ① 単色の下地を2.5倍に拡大して敷く（旧ラスターと同じ補間になるよう、周囲の余白つきの作業canvasを使う）
//   ② translate(-タイル原点) でワールド座標のまま、セルごとにパターンをfillRect（パターンの基準がワールド座標に固定され、タイル境界で模様がずれない）
// セルが無いタイルは null。
function bakeTextureTile(tx, ty, key){
  if(tileEmpty.has(key)) return null;
  if(!tileHasCells(tx, ty)){ tileEmpty.add(key); return null; }
  const t0 = performance.now();
  const m = TILE_SCRATCH_MARGIN, S = SOLID_TILE_SCALE, T = TEX_TILE_SCALE;
  const sc = tileScratch._ctx;
  sc.setTransform(1, 0, 0, 1, 0, 0); sc.clearRect(0, 0, tileScratch.width, tileScratch.height);
  paintSolidCells(sc, tx, ty, m);
  const cv = takeTileCanvas(tilePoolTex, tileTexPx);
  const c2d = cv._ctx;
  c2d.setTransform(1, 0, 0, 1, 0, 0);
  const k = T / S; // 2.5
  c2d.drawImage(tileScratch, -m * k, -m * k, tileScratch.width * k, tileScratch.height * k);
  c2d.setTransform(1, 0, 0, 1, -tileTexPx * tx, -tileTexPx * ty);
  const cellWpx = Math.ceil(MESH_CELL_LON_DEG * PX_PER_DEG_LON * T) + 1;
  const cellHpx = Math.ceil(MESH_CELL_LAT_DEG * PX_PER_DEG_LAT * T) + 1;
  tileCellWindow(tx, ty);
  forEachLanduseCellInWindow(_wRowMin, _wRowMax, _wColMin, _wColMax, (meshCode, v)=>{
    const pattern = tilePatterns[tileFileForCode[LANDUSE_ORDER[v - 1]]];
    if(!pattern) return;
    const wx = worldX(_cellLon + MESH_CELL_LON_DEG/2), wy = worldY(_cellLat + MESH_CELL_LAT_DEG/2);
    const rx = (wx - tileOriginX) * T, ry = (wy - tileOriginY) * T;
    c2d.fillStyle = pattern;
    c2d.fillRect(rx - cellWpx/2, ry - cellHpx/2, cellWpx, cellHpx);
  });
  c2d.setTransform(1, 0, 0, 1, 0, 0);
  const ms = performance.now() - t0;
  tileStats.texBakes++; tileStats.texBakeMs += ms; if(ms > tileStats.texBakeMaxMs) tileStats.texBakeMaxMs = ms;
  return cv;
}
function bakeAndStoreTextureTile(tx, ty, key){
  const cv = bakeTextureTile(tx, ty, key);
  if(!cv) return false;
  texTiles.set(key, { cv, last: tileFrame });
  evictTiles(texTiles, tilePoolTex, CONFIG.TILE_CACHE_MAX_TEXTURED, 'evictionsTex');
  return true;
}

// LRU：上限を超えたら、最終使用フレームが古いものから捨てる（現在画面に映っている＝今フレームで使ったタイルは捨てない）。
// 捨てたcanvasはプールに戻して再利用する。
function evictTiles(map, pool, max, statName){
  while(map.size > max){
    let oldKey = -1, oldLast = Infinity;
    for(const [k, e] of map){ if(e.last < tileFrame && e.last < oldLast){ oldLast = e.last; oldKey = k; } }
    if(oldKey === -1) break;
    const e = map.get(oldKey);
    map.delete(oldKey);
    releaseTileCanvas(pool, e.cv);
    tileStats[statName]++;
  }
}

// ---- 毎フレームのbakeスケジュール ----
// 画面に映るタイル＋周囲 CONFIG.TILE_PREFETCH タイルのうち、未生成のテクスチャタイルを、プレイヤーに近い順に焼く。
// 1フレームのbakeは最大 CONFIG.TILE_BAKES_PER_FRAME 枚、合計 CONFIG.TILE_BAKE_BUDGET_MS を超えない範囲
// （ただし画面内に未生成があれば、最低1枚は必ず焼く）。
function scheduleTextureBakes(pWX, pWY, vx0, vx1, vy0, vy1){
  const pad = CONFIG.TILE_PREFETCH;
  const x0 = Math.max(0, vx0 - pad), x1 = Math.min(tilesX - 1, vx1 + pad);
  const y0 = Math.max(0, vy0 - pad), y1 = Math.min(tilesY - 1, vy1 + pad);
  const cands = [];
  for(let ty = y0; ty <= y1; ty++){
    for(let tx = x0; tx <= x1; tx++){
      const key = ty * tilesX + tx;
      if(texTiles.has(key) || tileEmpty.has(key)) continue;
      const dx = tileOriginX + (tx + 0.5) * tileWorldPx - pWX, dy = tileOriginY + (ty + 0.5) * tileWorldPx - pWY;
      cands.push({ tx, ty, key, vis: (tx >= vx0 && tx <= vx1 && ty >= vy0 && ty <= vy1), d: dx*dx + dy*dy });
    }
  }
  if(cands.length === 0) return;
  cands.sort((a, b)=> a.d - b.d);
  const vi = cands.findIndex(c => c.vis);
  if(vi > 0){ cands.unshift(cands.splice(vi, 1)[0]); } // 画面内の未生成のうち最も近いものを先頭に（最低1枚は必ず焼く）
  const t0 = performance.now();
  let n = 0;
  for(const c of cands){
    if(n >= CONFIG.TILE_BAKES_PER_FRAME) break;
    if(n >= 1 && performance.now() - t0 >= CONFIG.TILE_BAKE_BUDGET_MS) break;
    if(bakeAndStoreTextureTile(c.tx, c.ty, c.key)) n++; // セルが無いタイル(空)は数えない
  }
}

// 画面に映るタイルの範囲（ワールド座標の中心 pWX,pWY、ズーム z）
function tileViewRange(pWX, pWY, z){
  const halfW = W/(2*z) + 2, halfH = H/(2*z) + 2;
  return [Math.max(0, Math.floor((pWX - halfW - tileOriginX) / tileWorldPx)), Math.min(tilesX - 1, Math.floor((pWX + halfW - tileOriginX) / tileWorldPx)),
          Math.max(0, Math.floor((pWY - halfH - tileOriginY) / tileWorldPx)), Math.min(tilesY - 1, Math.floor((pWY + halfH - tileOriginY) / tileWorldPx))];
}

// ---- 地形の描画（draw() から、県境クリップの中で呼ぶ）----
// 画面に映るタイルを drawImage で貼る。貼り付け先の端は、ズーム・カメラ変換で求めた画面座標を整数pxにスナップし
// （隣り合うタイルの境界は同じ式の同じ丸め値）、幅は「次のタイルの端－このタイルの端」で求めるので、隙間も重なりも出ない。
// テクスチャONで読み込み完了済み＆テクスチャタイルがキャッシュにあればそれを、無ければ単色タイル（タイルごとのフォールバック）を使う。
function drawTerrainTiles(pWX, pWY, z, textureOn){
  if(!landuseGrid || tilesX <= 0) return;
  tileFrame++;
  const [vx0, vx1, vy0, vy1] = tileViewRange(pWX, pWY, z);
  if(vx0 > vx1 || vy0 > vy1) return;
  const useTex = !!textureOn && tileTexturesReady;
  if(useTex) scheduleTextureBakes(pWX, pWY, vx0, vx1, vy0, vy1);
  const nx = vx1 - vx0 + 1, ny = vy1 - vy0 + 1;
  const ex = new Array(nx + 1), ey = new Array(ny + 1);
  for(let i = 0; i <= nx; i++) ex[i] = Math.round(W/2 + (tileOriginX + (vx0 + i) * tileWorldPx - pWX) * z);
  for(let j = 0; j <= ny; j++) ey[j] = Math.round(H/2 + (tileOriginY + (vy0 + j) * tileWorldPx - pWY) * z);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // 画面（デバイス）座標で貼る。県境クリップはデバイス座標で保持されている
  for(let j = 0; j < ny; j++){
    for(let i = 0; i < nx; i++){
      const tx = vx0 + i, ty = vy0 + j, key = ty * tilesX + tx;
      if(tileEmpty.has(key)) continue;
      let cv = null;
      if(useTex){ const e = texTiles.get(key); if(e){ e.last = tileFrame; cv = e.cv; } }
      if(!cv) cv = getSolidTile(tx, ty, key);
      if(!cv) continue;
      const dw = ex[i+1] - ex[i], dh = ey[j+1] - ey[j];
      if(dw <= 0 || dh <= 0) continue;
      try { ctx.drawImage(cv, 0, 0, cv.width, cv.height, ex[i], ey[j], dw, dh); }
      catch(e){ /* 描画に失敗したタイルはこのフレームだけ飛ばす */ }
    }
  }
  ctx.restore();
}

// 指定の位置の周囲（画面＋ring周）のテクスチャタイルを、予算なしで同期的に焼く（ゲーム開始前・再プレイ時）。
function prebakeTerrainTiles(pWX, pWY, z, ring){
  if(!tileTexturesReady || !landuseGrid) return;
  tileFrame++;
  const t0 = performance.now();
  const [vx0, vx1, vy0, vy1] = tileViewRange(pWX, pWY, z);
  for(let ty = Math.max(0, vy0 - ring); ty <= Math.min(tilesY - 1, vy1 + ring); ty++){
    for(let tx = Math.max(0, vx0 - ring); tx <= Math.min(tilesX - 1, vx1 + ring); tx++){
      const key = ty * tilesX + tx;
      if(texTiles.has(key) || tileEmpty.has(key)) continue;
      if(bakeAndStoreTextureTile(tx, ty, key)) tileStats.prebakeTiles++;
    }
  }
  tileStats.prebakeMs += performance.now() - t0;
}
function prebakeTerrainAtPlayer(ring){
  prebakeTerrainTiles(worldX(state.player.lon), worldY(state.player.lat), cameraZoom, ring);
}

// ゲーム開始の入口：テクスチャの読み込みが終わる（失敗も含む）のを待ち、スポーン周辺（画面＋1周）を先に焼いてから cb を呼ぶ。
// 読み込みが CONFIG.TILE_START_WAIT_MS を超えて終わらない時は、単色タイルのまま開始する（そのうち焼き込みに切り替わる）。
function terrainStartWhenReady(cb){
  const t0 = performance.now();
  const tick = ()=>{
    if(terrainTexturesFinished()){
      prebakeTerrainAtPlayer(1);
      cb(); return;
    }
    if(performance.now() - t0 > CONFIG.TILE_START_WAIT_MS){
      console.warn('[terrain] テクスチャの読み込みが終わらないため、単色タイルで開始します');
      cb(); return;
    }
    setTimeout(tick, 30);
  };
  tick();
}

// タイルの状態（検証・開発確認用）。canvasの合計ピクセル数は、キャッシュ中のタイル＋プール＋作業canvas。
function terrainTileInfo(){
  let pxTex = 0, pxSolid = 0, pxPool = 0;
  for(const e of texTiles.values()) pxTex += e.cv.width * e.cv.height;
  for(const e of solidTiles.values()) pxSolid += e.cv.width * e.cv.height;
  tilePoolTex.forEach(cv => { pxPool += cv.width * cv.height; }); tilePoolSolid.forEach(cv => { pxPool += cv.width * cv.height; });
  const pxScratch = tileScratch ? tileScratch.width * tileScratch.height : 0;
  return { tex: texTiles.size, solid: solidTiles.size, empty: tileEmpty.size, poolTex: tilePoolTex.length, poolSolid: tilePoolSolid.length,
           pxTex, pxSolid, pxPool, pxScratch, pxTotal: pxTex + pxSolid + pxPool + pxScratch, tilesX, tilesY, tileWorldPx, texturesReady: tileTexturesReady, frame: tileFrame,
           stats: Object.assign({}, tileStats) };
}

// ==== 鉄道路線の描画（rail_data.js の RAIL_ROUTES を使用） ====
// 路線はプレイヤー位置に関わらず変化しない静的情報なので、起動時に1回だけオフスクリーンcanvasへ描画し、
// 毎フレームはそのcanvasをdrawImageで貼るだけにする（地形のタイルとは別に、起動時に1回だけ描く方式）。
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
// 色は、地形テクスチャの水面や各RAIL_STYLEの色と衝突しないよう、
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
  disposeTerrainTiles();            // 前の県のタイル・プール・作業canvasをすべて破棄（width/height=0で解放）してから作り直す
  textureLoadFinished = 0;          // テクスチャ読み込みの完了数・画像も作り直す
  for(const k of Object.keys(TEXTURE_IMAGES)) delete TEXTURE_IMAGES[k];
  buildLanduseGrid();               // 土地利用メッシュ格子（RLEをUint8Arrayへ直接展開。展開後 MESH_RUNS_FLAT は null）
  initTileSystem();                 // 地形タイル（原点・タイル数・作業canvas・色/テクスチャの対応）。タイル本体は draw のたびに必要な分だけ作る
  startTextureLoads();              // テクスチャ画像の読み込み開始（12枚そろったらパターンを作り、タイルのbakeが始まる）
  buildRailCanvas();                // 鉄道canvas
  buildRiverCanvas();               // 河川canvas
}
