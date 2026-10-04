// ======================================================================
// tools/build_available_prefs.js  （任意のツール。ゲーム本体はこれに依存しない）
// 実行方法（プロジェクトのルートで1行）：
//     node tools/build_available_prefs.js
// data/ 配下の pref<XX> フォルダを調べ、次の4ファイルがすべて存在する県だけを列挙して
// data/available_prefs.js を作り直す：
//     data_mesh.js / rail_data.js / river_data.js / knowledge_<XX>.js
// ======================================================================
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const outFile = path.join(dataDir, 'available_prefs.js');

const codes = [];
const skipped = [];
for(const name of fs.readdirSync(dataDir).sort()){
  const m = /^pref(\d{2})$/.exec(name);
  if(!m || !fs.statSync(path.join(dataDir, name)).isDirectory()) continue;
  const xx = m[1];
  const code = Number(xx);
  if(code < 1 || code > 47){ skipped.push(name + '（県コードが1〜47の範囲外）'); continue; }
  const need = ['data_mesh.js', 'rail_data.js', 'river_data.js', 'knowledge_' + xx + '.js'];
  const missing = need.filter(f => !fs.existsSync(path.join(dataDir, name, f)));
  if(missing.length === 0) codes.push(code);
  else skipped.push(name + '（不足: ' + missing.join(', ') + '）');
}

const body = `// ======================================================================
// data/available_prefs.js
// データが揃っている県コード（数値）の一覧。ゲームはここに載っている県だけを選ぶ。
// 「揃っている」＝ data/pref<XX>/ に次の4ファイルがすべてある（XXは2桁ゼロ埋めの県コード）：
//   data_mesh.js / rail_data.js / river_data.js / knowledge_<XX>.js
// 手書きで編集してよい。または Node.js で再生成できる：  node tools/build_available_prefs.js
// ======================================================================
var AVAILABLE_PREFECTURE_CODES = [${codes.join(', ')}];
`;
fs.writeFileSync(outFile, body);
console.log('data/available_prefs.js を更新しました: [' + codes.join(', ') + ']');
if(skipped.length) console.log('含めなかったフォルダ: ' + skipped.join(' / '));
