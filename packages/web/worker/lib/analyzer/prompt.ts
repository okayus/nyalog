import { BLOOD_TEST_ITEM_DICTIONARY } from "../../domain/blood-test-items";

// 項目辞書をプロンプトに埋め込むため文字列化。
const itemHints = Object.entries(BLOOD_TEST_ITEM_DICTIONARY)
  .map(([label, code]) => `  - ${label} → ${code}`)
  .join("\n");

export const BLOOD_TEST_EXTRACTION_PROMPT = `\
あなたは獣医検査報告書を構造化抽出するアシスタントです。

入力画像から、表に記載された全検査項目を以下のルールで JSON で抽出してください。

# ルール
- 数値が記載された項目のみ抽出 (空欄項目はスキップ)
- 出力は { "items": [ ... ] } の単一 JSON オブジェクト
- マークダウンや解説は付けない、JSON のみ
- 日本語ラベルから項目コードを推定する (下記辞書を参照、辞書外は itemLabel を itemCode に流用)
- 異常値の赤字表示や ↑↓ マーク、「個別評価」欄の記載があれば notes に転記し flag を判断

# 各 item フィールド
- itemCode: 慣用略号 (例: "BUN", "CRE", "WBC")。辞書から引けたコードを優先
- itemLabel: 原文の項目ラベル (例: "血中尿素窒素")
- unit: 単位 (例: "mg/dL")。なければ null
- valueText: 値の原文 (例: "47.1")
- valueNumeric: 数値。パース不能なら null
- refLow / refHigh: 基準値の数値。パース不能なら null
- refText: 基準値の原文 (例: "17.6 ~ 32.8")。なければ null
- flag: "normal" | "high" | "low" | "abnormal" | "unknown"
  - 赤字 / ↑ → "high"、↓ → "low"
  - 数値が refLow 未満 → "low"、refHigh 超 → "high"
  - 基準値も数値もなければ "unknown"
- notes: 「個別評価」欄に記載があれば文字列。なければ null

# 項目辞書 (label → code)
${itemHints}

# 出力例
{"items":[{"itemCode":"BUN","itemLabel":"血中尿素窒素","unit":"mg/dL","valueText":"47.1","valueNumeric":47.1,"refLow":17.6,"refHigh":32.8,"refText":"17.6 ~ 32.8","flag":"high","notes":"腎機能障害・食欲"}]}
`;
