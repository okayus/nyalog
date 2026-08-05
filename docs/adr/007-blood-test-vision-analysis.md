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

実装は **`WorkersAIGemmaAnalyzer`** (default: `@cf/google/gemma-4-26b-a4b-it`、当初は `@cf/google/gemma-3-12b-it` — [Addendum](#addendum-2026-08-05-gemma-3-12b-の-deprecation-と-gemma-4-への移行) 参照) のみ。env 経由で `ANALYZER_MODEL` を切り替え可能 (現状は Gemma 固定だが、`factory.ts` の switch を 1 箇所増やせば差し替え完了)。

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
- **使用中のモデルが Workers AI の deprecation リストに載る** → 後継モデルへ移行 ([Addendum](#addendum-2026-08-05-gemma-3-12b-の-deprecation-と-gemma-4-への移行))。deprecation はアプリ側に一切通知が来ないので、Cloudflare の [changelog](https://developers.cloudflare.com/changelog/product/workers-ai/) 頼み

## 関連

- [ADR-005](./005-per-space-membership.md) — per-space 認可。`getBloodTestAnalysis` も `memberSpaceIds` チェックを cat 経由で間接的に効かせている
- [ADR-006](./006-medical-records-r2.md) — R2 + Worker proxy 配信。本 ADR の解析対象は ADR-006 の attachment
- [okayus-skills `cloudflare-workflows-for-long-tasks`](https://github.com/okayus/okayus-skills/tree/main/skills/cloudflare-workflows-for-long-tasks) — Workflow 関連の落とし穴 (`Workflow<Params>` 型, bytes を step 跨ぎで渡さない, step.do の冪等性) の skill 化

## Addendum (2026-08-05): Gemma 3 12B の deprecation と Gemma 4 への移行

`@cf/google/gemma-3-12b-it` は [2026-05-08 の changelog](https://developers.cloudflare.com/changelog/post/2026-05-08-planned-model-deprecations/) で告知された catalog 整理の対象 18 モデルに含まれ、**2026-05-30 に deprecated** となった。Kimi K2.5 のような後継への自動 alias は告知されていない。default を Cloudflare 推奨の後継 **`@cf/google/gemma-4-26b-a4b-it`** に差し替える。

**期限を 2 ヶ月過ぎるまで気づかなかった**。deprecation はデプロイ済みアプリに何も通知しない上、nyalog では解析失敗が UI 上「status=failed の解析」として静かに溜まるだけで、家族の誰も画像を上げていない期間は誰の目にも触れない。上記「移行トリガー」に changelog 監視の項を足した。

### 「`factory.ts` の switch を 1 箇所増やせば差し替え完了」ではなかった

本 ADR の「2. `BloodTestAnalyzer` interface を切る」で見込んだ差し替えコストは、同じ Workers AI 内の世代交代には効かなかった。gemma-4 は **OpenAI 互換の chat completions schema** で、gemma-3 の vision 用 schema とは入出力ごと別物:

| | gemma-3-12b-it | gemma-4-26b-a4b-it |
| --- | --- | --- |
| プロンプト | `{ prompt: string }` | `{ messages: [{ role, content: part[] }] }` |
| 画像 | `{ image: number[] }` (生バイト列) | content part `{ type: "image_url", image_url: { url } }` (data URI) |
| 出力 | `{ response: string }` | `{ choices: [{ message: { content } }] }` |
| 生成上限 | `max_tokens` | `max_completion_tokens` (`max_tokens` は deprecated) |
| JSON 強制 | なし (プロンプト頼み) | `response_format: { type: "json_object" }` |

`response_format` は新 schema で拾えた収穫。`parseGemmaJsonResponse` は応答全体が 1 個の JSON であることを要求する (前置きの散文が付くと `parse_error`) 一方、gemma-4 は reasoning 系でプロンプトの「JSON のみ」指示だけでは心許ない。schema 側でも縛る。

interface (`BloodTestAnalyzer`) の外側 — Workflow / API / UI — は無変更で済んだので、境界の切り方自体は正しかった。差し替えが 1 行で済むのは「実装ファイルを 1 個足す」場合であって、**同じファイル内でのモデル更新は呼び出し規約の変更を伴いうる**、というのが実際の粒度。

画像 bytes → data URI の変換 (`toImageDataUri`) は純粋関数として切り出してユニットテストを持たせた。`String.fromCharCode(...bytes)` の spread が添付上限 10MB で call stack を溢れさせるため chunk 分割しており、境界の取りこぼしは本番でしか出ない類の壊れ方をする。

### コスト

単価はむしろ下がった (`$0.35 / $0.56` per M in/out → **`$0.10 / $0.30`**)。1 枚あたり 150〜290 Neurons の見積もりに対し無料枠は 10,000 Neurons/日なので、いずれにせよ家族利用では課金領域に入らない。

### 検証

ADR-008 のとおり dev / CI では `mock` analyzer 固定で、実モデルの呼び出し規約が正しいかは**ローカルでは一切検証できない**。本番デプロイ後に血液検査画像を 1 枚アップロードし、`blood_test_analyses` の `status` が `succeeded` になること、`model_name` が gemma-4 になっていることを確認する必要がある。失敗時は `error_message` に `model_error` / `io_error` が残る。
