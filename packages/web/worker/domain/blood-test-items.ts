// 動物病院の検査報告書に出てくる項目ラベル → 慣用略号 (item code) の lookup table。
// AI 出力に code が来なかった (or 不正だった) 時に label から引く。
//
// 辞書漏れは itemCode = itemLabel (原文ママ) で DB に保存し、人手レビューで修正する前提。
// 完全一致のみ。表記ゆれ ("ヘマトクリット" vs "ヘマトクリット値") は両エントリを並べる。
export const BLOOD_TEST_ITEM_DICTIONARY: Record<string, string> = {
  // CBC
  総白血球数: "WBC",
  白血球数: "WBC",
  桿状好中球: "Sta",
  分節好中球: "Seg",
  リンパ球: "Lym",
  単球: "Mon",
  好酸球: "Eos",
  好塩基球: "Bas",
  赤血球数: "RBC",
  ヘモグロビン濃度: "Hb",
  ヘマトクリット値: "HCT",
  血液の濃度: "HCT",
  血小板: "Plt",
  // 生化学
  総蛋白量: "TP",
  アルブミン: "ALB",
  グロブリン: "GLB",
  "肝酵素(AST)": "GOT",
  "肝酵素(細胞障害)": "GPT",
  "肝酵素、肝機能": "ALP",
  黄疸の指標: "T-Bil",
  総コレステロール: "T-CHO",
  トリグリセリド: "TG",
  リパーゼ: "LIP",
  血中尿素窒素: "BUN",
  腎臓機能: "CRE",
  リン: "IP",
  カルシウム: "Ca",
  アンモニア: "NH3",
  C反応性蛋白: "CRP",
  血清アミロイドA: "SAA",
  // 電解質
  ナトリウム: "Na",
  カリウム: "K",
  クロール: "Cl",
  // ホルモン
  T4: "T4",
  TSH: "TSH",
  "コルチゾール(pre)": "COR-pre",
  "コルチゾール(post)": "COR-post",
  // 胆汁酸
  "総胆汁酸(空腹時)": "TBA-fast",
  "総胆汁酸(食後)": "TBA-pp",
  // 凝固
  プロトロンビン時間: "PT",
  活性化部分トロンボプラスチン時間: "APTT",
  血漿フィブリノゲン濃度: "Fbg",
};

export function lookupItemCode(label: string): string {
  const trimmed = label.trim();
  return BLOOD_TEST_ITEM_DICTIONARY[trimmed] ?? trimmed;
}
