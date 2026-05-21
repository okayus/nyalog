## ADR-007: 血液検査 Vision 解析と表示の設計

- ステータス: Accepted
- 日付: 2026-05-21
- 関連 PR: [#45](https://github.com/okayus/nyalog/pull/45) (schema + analyzer 雛形), [#46](https://github.com/okayus/nyalog/pull/46) (API + 非同期トリガー), [#47](https://github.com/okayus/nyalog/pull/47) (Workflows 移行), [#56](https://github.com/okayus/nyalog/pull/56) (D1 chunking fix), [#57](https://github.com/okayus/nyalog/pull/57) (純粋関数), [#58](https://github.com/okayus/nyalog/pull/58) (表 + 前回比), [#59](https://github.com/okayus/nyalog/pull/59) (sparkline + popover)

## 背景

[ADR-006](./006-medical-records-r2.md) で実装した医療記録 (R2 配信) の上に、血液検査画像を Vision LLM で構造化抽出して「項目 / 値 / 単位 / 基準範囲 / フラグ」の行として保存し、家族が前回比と推移を見られる UI を載せたい。3 つの主要な設計判断を本 ADR でまとめる。

1. **解析は durable な非同期実行にする** — Workers AI Gemma 12B vision はリクエストあたり 1〜7 分で、Worker のリクエストスコープでは完走できない
2. **analyzer は interface で差し替え可能にする** — 1 つの Vision モデルに永続結婚しない (Gemma 応答時間や精度が将来要件を満たさなくなる可能性がある)
3. **表示の集約は client 側で行う** — REST endpoint はドメインの名詞 (per-attachment analysis) のままにし、cross-attachment の時系列展開はフロントエンドで合成する

## 決定

### 1. Cloudflare Workflows で durable に解析する

`AnalyzeBloodTestWorkflow extends WorkflowEntrypoint` を 1 個用意し、attachment upload と `POST /analyze` の両方から `c.env.ANALYZE_WORKFLOW.create({ params: { analysisId, r2Key } })` で kick する。Workflow は 3 step で構成:

| step                | 内容                                                                                                        | 失敗時の挙動                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `mark-running`      | `blood_test_analyses.status` を `running` にし `started_at` を埋める                                        | step 単体で retry なし。throw すれば catch で `mark-failed` step に落ちる     |
| `fetch-and-analyze` | R2 から画像 bytes を読み、`createAnalyzer(env).analyze(...)` を呼び、items + raw response + model 名を返す  | `retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }`、5 分 timeout |
| `persist-values`    | 既存 values を delete してから、抽出された items を **5 行ずつ chunk** に分けて insert、status を `succeeded` に | catch で `mark-failed`、`error_message` に詳細を残す                          |

step の戻り値は JSON serializable に限定される (workers runtime 制約)。画像 bytes は `fetch-and-analyze` の中だけで保持し、step を跨いでは items / rawResponse / modelName (小さい JSON) のみ渡す。

### 2. `BloodTestAnalyzer` interface を切る

```ts
type AnalyzeInput = { imageBuffer: ArrayBuffer; contentType: string };
type AnalyzeOutput = { items: ExtractedItem[]; rawResponse: string };

interface BloodTestAnalyzer {
  readonly modelName: string;
  analyze(input: AnalyzeInput): Promise<Result<AnalyzeOutput, AnalysisError>>;
}
```

実装は **`WorkersAIGemmaAnalyzer`** (default: `@cf/google/gemma-3-12b-it`) のみ。env 経由で `ANALYZER_MODEL` を切り替え可能 (現状は Gemma 固定だが、`factory.ts` の switch を 1 箇所増やせば差し替え完了)。

差し替え可能性が必要な理由:
- **応答時間が不確実**: 初回本番計測で Gemma が **7 分 17 秒** を記録 (#47 で観測)、その後の検証では 97 秒。Workers AI の colo 状態に依存して大きくぶれる
- **抽出精度が不確実**: 項目辞書 (`blood-test-items.ts`) は AI が `item_code` を出さなかった時の lookup fallback だが、Gemma が label を表記揺れさせて辞書ヒットしないケースが将来発生し得る
- **Vision LLM 市場が動いている**: Claude Vision (Sonnet 4.6) や自前 OCR + 軽量 LLM 等への乗り換えがありうる

interface 越しに見える境界は「画像 bytes と content-type を入れたら、構造化された items が返ってくる」だけ。Workflow / API / UI のいずれも analyzer の実装詳細を知らない。

### 3. 表示の集約は client 側、REST endpoint は per-attachment のまま

cross-attachment の時系列を見せるには「ある猫の全 succeeded analysis + values」を joined で取れる必要がある。選択肢:

| アプローチ                                                               | 評価                                                                                                                       |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **A. 新しい presentation endpoint** (`GET /api/cats/:catId/blood-test-series`) | 1 RTT で全部取れる。だが REST 名前空間にプレゼン層の射影を持ち込む = ドメインの名詞ではない                                |
| **B. 既存 per-attachment endpoint を並列フェッチ + client 側で aggregate**   | RTT は N + 1 になるが、家族規模 (per cat の attachment 数 ~10〜30 が現実的上限) では実害なし。REST = ドメインのファサード、プレゼン射影 = client の役割分担が綺麗に成立 |

**B を採用**。`MedicalRecordsView` の `useEffect` で blood_test record の image attachment 全件に対して `getBloodTestAnalysis` を並列フェッチし、`useMemo` で `buildItemSeries(analyses[])` を `item_code` 軸の `Record<string, ItemSeriesPoint[]>` に展開する。`MedicalRecordsView.tsx:82-93` の既存 attachment N+1 と同じ「家族規模なので N+1 を許容」スタンスを継承する。

trend 表示が将来パフォーマンス的に問題になったら、その時点で集約 endpoint を新設する (premature optimization を避ける)。

## 実装

### 表示ロジックは純粋関数 + Discriminated Union

`packages/web/src/components/blood-test-display.ts` に 5 つの純粋関数を集約:

| 関数                                | 入力 → 出力                                                                                       | 用途                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `buildItemSeries(analyses[])`       | `AnalysisForDisplay[]` → `Record<itemCode, ItemSeriesPoint[]>` (date 昇順)                        | cross-attachment 時系列の構築                              |
| `findPreviousPoint(series, date)`   | series + ISO 日時 → `ItemSeriesPoint \| null`                                                     | 前回比計算用、指定日より前の最新点                          |
| `computeDelta(prev, curr, lo, hi)`  | 値 + ref range → DU (`no_previous` / `non_numeric` / `no_change` / `change`)                      | 前回比 + `towardNormal: "toward" \| "away" \| "neutral"`   |
| `buildItemChartGeometry(...)`       | points + ref range → DU (`empty` / `single` / `line`) + 任意 `refBand`                            | 詳細チャート (popover) の geometry                          |
| `buildSparklineGeometry(...)`       | points → DU (`empty` / `dot` / `line`)                                                            | テーブル inline 用 60×20px の極小 geometry                  |
| `groupItemsByCategory(items[])`     | values → `{ category, items }[]` (canonical order)                                                | CBC / 生化学 / 電解質 / ホルモン / 胆汁酸 / 凝固 / その他   |

vitest 31 cases で意味的契約を固定する (empty / single / line geometry, delta の全 branch, ref-band 有無, unknown-code → その他 fallback, 等)。SVG レンダリング側 (`Sparkline.tsx` / `ItemDetailChart.tsx`) は DU を分岐表示するだけの dumb component で、テストは playwright の e2e に任せる範囲外。

### 「前回比」の `towardNormal` 判定ロジック

「方向 (上 / 下)」ではなく「基準範囲との距離が縮まったか広がったか」で色付けする:

```ts
function distanceToRange(v, lo, hi): number {
  if (v < (lo ?? -Inf)) return lo - v;
  if (v > (hi ?? +Inf)) return v - hi;
  return 0;  // 範囲内 (境界含む) は 0
}
// prevDist === 0 && currDist === 0   → neutral (範囲内の揺れ)
// currDist < prevDist                → toward (改善)
// currDist > prevDist                → away (悪化)
// 等距離 or refs 両方 null            → neutral
```

具体例:
- `Hb 14.0 → 15.6` (refHigh 15.5 越え): prevDist=0, currDist=0.1 → **away** (赤)
- `Hb 16.5 → 15.6` (range に復帰): prevDist=1.0, currDist=0 → **toward** (緑)
- `Hb 14.0 → 14.5` (両者 range 内): 両 0 → **neutral** (灰)
- ref 両方 null: 常に **neutral** (判定材料なし)

「上がった = 悪い」の素朴な解釈を避け、ref 範囲をクロスする時だけ警告色を出すので、健康な範囲内の揺れを false positive で「悪化」と読まない。

### カテゴリ辞書

`worker/domain/blood-test-items.ts` で `BLOOD_TEST_CATEGORIES` を定義。AI 出力の `item_code` が知っていれば該当カテゴリに、知らなければ「その他」に流す。canonical 表示順は `BLOOD_TEST_CATEGORY_ORDER` で固定 (CBC → 生化学 → 電解質 → ホルモン → 胆汁酸 → 凝固 → その他)。

`MedicalRecordsView` 上ではデフォルトで CBC + 生化学を `<details open>`、それ以外は collapsed (モバイル縦スクロール抑制)。

### D1 placeholder 上限への対応

`bloodTestValues` は 16 列。1 SQL に 34 行まとめると 544 placeholders で D1 の **per-statement 100 placeholders 制限** に当たる ([#47](https://github.com/okayus/nyalog/pull/47) の最初の本番 upload で発生)。`persist-values` step では **5 行ずつ chunk** (80 placeholders、20 placeholder の安全マージン) に分割。再 trigger 時の冪等性は「delete → chunked insert」で維持される ([#56](https://github.com/okayus/nyalog/pull/56) で導入)。

## やらなかった選択

- **同期解析** (`POST /analyze` で AI 呼び出しを待ち、values と一緒に返す) — 30 秒以内に終わらないリクエストが現実にある以上不可
- **ctx.waitUntil() で background 処理** — wall-clock 30 秒上限。最初これで実装したが [#47](https://github.com/okayus/nyalog/pull/47) で 7 分処理が kill されて Workflow に移行
- **Durable Object + Queue 自作** — 失敗時の retry / persistence / observability を自分で書くコストが Workflows の learning curve より高い
- **集約 endpoint (`/api/cats/:catId/blood-test-series`) の新設** — 上記「3. 表示の集約は client 側」参照。家族規模では N+1 が実害にならない、REST 名前空間を presentation 射影で汚さない方が将来の保守性が高い
- **Cloudflare Images Paid を併用してサムネイル化** — [ADR-006](./006-medical-records-r2.md) のとおり不採用
- **Vision モデルを直接呼ぶハードコード実装** — interface を切らないと将来差し替えコストが分散する

## 移行トリガー

以下のうち 1 つでも当てはまったら次の検討に入る:

- **Gemma 応答時間が再び数分台に常態化** → `BloodTestAnalyzer` の差し替えで Claude Vision (Sonnet 4.6) を試す。期待値は 5〜15 秒、月数十件規模ならコストも家族用途では現実的
- **抽出漏れ / 誤抽出が UI で目立つ** → AI 出力後の inline 編集 UI を実装 (CRUD endpoint は既にある、`PUT /analysis/values/:id` が `reviewed=true` を自動セット)
- **trend 表示で初回ロード時間が体感的に遅い** → 集約 endpoint `/blood-test-series` を新設して 1 RTT 化

## 関連

- [ADR-005](./005-per-space-membership.md) — per-space 認可。`getBloodTestAnalysis` も `memberSpaceIds` チェックを cat 経由で間接的に効かせている
- [ADR-006](./006-medical-records-r2.md) — R2 + Worker proxy 配信。本 ADR の解析対象は ADR-006 の attachment
- [okayus-skills `cloudflare-workflows-for-long-tasks`](https://github.com/okayus/okayus-skills/tree/main/skills/cloudflare-workflows-for-long-tasks) — Workflow 関連の落とし穴 (`Workflow<Params>` 型, bytes を step 跨ぎで渡さない, step.do の冪等性) の skill 化
