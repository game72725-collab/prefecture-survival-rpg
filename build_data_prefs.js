// ======================================================================
// tools/build_data_prefs.js
// japan.topojson（dataofjapan/land）から、全国共通の背景輪郭 data_prefs.js を生成する。
//   node tools/build_data_prefs.js <japan.topojson> [出力先=data_prefs.js]
//   node tools/build_data_prefs.js <japan.topojson> --legacy-check <現在のdata_prefs.js>
//        … 東京を含めない旧設定で再生成し、現在のファイルと一致するか確認する（書き出さない）
// 外部ライブラリ不要（Node.js のみ）。
//
// 【設定（旧 data_prefs.js と完全一致することを確認済みの値）】
//   座標の丸め        : 小数4桁
//   島の絞り込み      : リングの外接矩形の対角線（度）が MIN_DIAG_DEG 以上のものだけ残す
//   間引き            : 頂点数が MAX_POINTS を超えるリングは、歩幅 n/(MAX_POINTS-1) を足し込んで
//                       floor した位置の頂点を MAX_POINTS 個拾う（最後は元の最終頂点＝閉じる点）
//   リングの並び      : topojson の geometries の順、各 MultiPolygon の中の順
//   東京(13)          : 本土（そのポリゴン群の最初の1つ。PREFECTURE_RING と同じ範囲）だけを入れる
// ======================================================================
'use strict';
const fs = require('fs');

const MIN_DIAG_DEG = 0.05;
const MAX_POINTS   = 36;
const DECIMALS     = 4;
const TOKYO_CODE   = 13;

function round4(v){ return Number(v.toFixed(DECIMALS)); }

// ---- topojson のデコード（円弧は差分エンコード） ----
function decodeTopology(topo){
  const [sx, sy] = topo.transform.scale;
  const [tx, ty] = topo.transform.translate;
  const arcs = topo.arcs.map(arc=>{
    let x = 0, y = 0;
    return arc.map(([dx,dy])=>{ x += dx; y += dy; return [x,y]; });   // 量子化座標（整数）
  });
  const arcPts = i => (i >= 0 ? arcs[i] : arcs[~i].slice().reverse());
  function ring(arcIdx){
    const q = [];
    arcIdx.forEach((i,k)=>{ const p = arcPts(i); for(let m = (k===0?0:1); m<p.length; m++) q.push(p[m]); });
    return q.map(([x,y])=>[round4(x*sx+tx), round4(y*sy+ty)]);
  }
  return { ring };
}

// ---- 県コード（properties.id。無ければ県名→コード） ----
function loadNameToCode(csvPath){
  const map = {};
  if(!csvPath || !fs.existsSync(csvPath)) return map;
  fs.readFileSync(csvPath,'utf8').split(/\r?\n/).slice(1).forEach(line=>{
    const c = line.split(',');
    if(c.length>=2 && c[0]) map[c[1]] = Number(c[0]);
  });
  return map;
}
function prefCodeOf(props, nameToCode){
  let code = props && Number(props.id);
  if(!(code>=1 && code<=47)) code = nameToCode[props && props.nam_ja];
  if(!(code>=1 && code<=47)) throw new Error('県コードを決められない: '+JSON.stringify(props));
  return code;
}

function bboxDiag(ring){
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
  ring.forEach(([x,y])=>{ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; });
  return Math.hypot(x1-x0, y1-y0);
}

// n > MAX_POINTS のとき MAX_POINTS 個に間引く（足し込み方式。floatの丸めまで含めて旧ファイルと一致）
function simplifyRing(ring){
  const n = ring.length;
  if(n <= MAX_POINTS) return ring;
  const step = n / (MAX_POINTS - 1);
  const out = [];
  let pos = 0;
  for(let j=0;j<MAX_POINTS;j++){ out.push(ring[Math.min(n-1, Math.floor(pos))]); pos += step; }
  out[MAX_POINTS-1] = ring[n-1];
  return out;
}

function build(topoPath, opts){
  opts = opts || {};
  const topo = JSON.parse(fs.readFileSync(topoPath,'utf8'));
  const dec = decodeTopology(topo);
  const nameToCode = loadNameToCode(opts.csvPath);
  const rings = [], codes = [];
  const stat = { polygons:0, keptByDiag:0, tokyoSkipped:0, holesIgnored:0 };
  Object.values(topo.objects).forEach(obj=>{
    obj.geometries.forEach(g=>{
      const code = prefCodeOf(g.properties, nameToCode);
      const polys = g.type==='MultiPolygon' ? g.arcs : [g.arcs];
      polys.forEach((poly, pi)=>{
        stat.polygons++;
        if(poly.length>1) stat.holesIgnored += poly.length-1;
        if(code===TOKYO_CODE){
          if(!opts.includeTokyo || pi!==0){ stat.tokyoSkipped++; return; }   // 本土＝最初のポリゴンだけ
        }else{
          // 外接矩形の判定は、間引く前の全頂点で行う
          if(bboxDiag(dec.ring(poly[0])) < MIN_DIAG_DEG) return;
          stat.keptByDiag++;
        }
        rings.push(simplifyRing(dec.ring(poly[0])));
        codes.push(code);
      });
    });
  });
  return { rings, codes, stat };
}

function flatten(rings){ return rings.map(r=>{ const f=[]; r.forEach(([x,y])=>f.push(x,y)); return f; }); }

// 数値の書式：旧ファイルに合わせ、整数値は「30.0」のように小数1桁で書く（値は同じ。差分を見やすくするため）
function fmtNum(v){ return Number.isInteger(v) ? v.toFixed(1) : String(v); }
function fmtFlat(flat){ return '[' + flat.map(f=>'['+f.map(fmtNum).join(',')+']').join(',') + ']'; }

function render(rings, codes){
  const flat = flatten(rings);
  const head =
`// ======================================================================
// data_prefs.js
// 全国の都道府県の簡略化ポリゴン（背景描画用。tools/build_data_prefs.js が japan.topojson から生成。直接編集しない）
//   OTHER_PREF_RINGS_FLAT … 各リング [lon,lat,lon,lat,…]（東京都は本土のみ。他県は島を含む）
//   OTHER_PREF_RING_CODES … 同じ長さ。各リングの都道府県コード（JIS、1〜47）
// 遊んでいる県のコードと一致するリングは、main.js 側で背景から除外する。
// ======================================================================

`;
  const body =
`var OTHER_PREF_RINGS_FLAT = ${fmtFlat(flat)};
var OTHER_PREF_RING_CODES = ${JSON.stringify(codes)};
`;
  return head + body + '\n// ==== 地図座標の準備 ====\n';
}

module.exports = { build, render, flatten, fmtFlat, simplifyRing, bboxDiag, MIN_DIAG_DEG, MAX_POINTS };

if(require.main === module){
  const args = process.argv.slice(2);
  const topoPath = args[0];
  if(!topoPath){ console.error('使い方: node tools/build_data_prefs.js <japan.topojson> [出力先 | --legacy-check <現在のdata_prefs.js>]'); process.exit(1); }
  const csv = require('path').join(__dirname,'..','prefecturalCapital.csv');
  if(args[1]==='--legacy-check'){
    const cur = fs.readFileSync(args[2],'utf8');
    const m = cur.match(/(?:const|var) OTHER_PREF_RINGS_FLAT = (\[\[[\s\S]*?\]\]);/);
    const curFlat = JSON.parse(m[1]);
    const r = build(topoPath, { includeTokyo:false, csvPath:csv });
    const newFlat = flatten(r.rings);
    const curText = m[1], newText = fmtFlat(newFlat);
    const sum = a => a.reduce((s,f)=>s+f.length/2,0);
    console.log('現在  : リング', curFlat.length, '頂点', sum(curFlat));
    console.log('再生成: リング', newFlat.length, '頂点', sum(newFlat));
    console.log('テキスト完全一致:', curText===newText);
    process.exit(curText===newText ? 0 : 2);
  }
  const out = args[1] || 'data_prefs.js';
  const r = build(topoPath, { includeTokyo:true, csvPath:csv });
  fs.writeFileSync(out, render(r.rings, r.codes));
  const verts = r.rings.reduce((s,x)=>s+x.length,0);
  console.log('書き出し:', out, 'リング', r.rings.length, '頂点', verts, 'サイズ', fs.statSync(out).size, 'bytes');
}
