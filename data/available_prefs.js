// ======================================================================
// data/available_prefs.js
// データが揃っている県コード（数値）の一覧。ゲームはここに載っている県だけを選ぶ。
// 「揃っている」＝ data/pref<XX>/ に次の4ファイルがすべてある（XXは2桁ゼロ埋めの県コード）：
//   data_mesh.js / rail_data.js / river_data.js / knowledge_<XX>.js
// 手書きで編集してよい。または Node.js で再生成できる：  node tools/build_available_prefs.js
// ======================================================================
var AVAILABLE_PREFECTURE_CODES = [13];
