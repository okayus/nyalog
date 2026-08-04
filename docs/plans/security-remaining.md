# セキュリティ残タスク (防御強化フェーズの続き)

[status.md](../status.md) からリンクされる詳細ドキュメント。主要対応は反映済みで、ここには残タスクとその前提だけを置く。

## 実施済みの前提 (2026-05 調査 + 対応、再調査不要)

- **エッジキャッシュの吸収**: `/.env` `/admin` `/wp-login.php` などの典型スキャンパスは CDN edge が SPA `index.html` を `cf-cache-status: HIT` で返し、Worker は起動しない。D1/CPU 消費なし
- **未認証で叩ける経路は限定的**: `/api/*` は session middleware で D1 不参照のまま 401。`/api/auth/login/begin` だけが challenge 生成 (CPU + invocation) を引き起こす
- **ビルド成果物の漏洩なし**: `.assetsignore` で `.dev.vars` / `wrangler.json` 除外、`assets.directory` は `dist/client` 限定
- **セキュリティヘッダ**: HSTS / CSP frame-ancestors / X-Frame-Options DENY / X-Content-Type-Options 付与済み
- PR [#49](https://github.com/okayus/nyalog/pull/49): Workers Observability (`head_sampling_rate: 1`) + `AUTH_RATE_LIMITER` (IP あたり 30 req/60s) を auth 4 経路に適用、本番反映済み (Worker version `8a11b677`)
- PR [#52](https://github.com/okayus/nyalog/pull/52): `robots.txt` で全 bot に `Disallow: /`
- **「`/_next/image` 暴走」型のコスト爆発は構造的に起きない**: Next.js/OpenNext 不使用で経路自体が無い / 画像配信は認証必須の Worker proxy / Cloudflare Images Transformation は [ADR-006](../adr/006-medical-records-r2.md) で不採用 (従量課金経路が無い)

## 残タスク

### Rate Limit 動作確認 (急ぎではない)

PR #49 deploy 後、本番 `/api/auth/login/begin` に **35 req 順次 / 60 req 並列 / 80 req 並列 / 持続 10 rps × 12s = 計 295 req** を実施したが、すべて 200 で 429 が一度も返らなかった。bundle には `c.env.AUTH_RATE_LIMITER.limit(...)` と `rate_limited` 文字列が含まれ middleware は動作しているので、`limit()` が `{ success: true }` を返し続けている挙動。

仮説:

1. Workers Rate Limiting は eventually consistent / approximate enforcement で突発バーストを取りこぼす設計 (docs 明記あり)
2. `simple.limit` のカウントは per Cloudflare colocation なので colo を跨ぐと閾値が緩くなる
3. 初回バインド使用直後の数分間はカウンタが収束しない可能性

再検証手順:

- 本番 deploy から 30 分〜数時間置いて同じバースト (持続 10 rps × 12s) を再実行し 429 が出るか
- 出ない場合は `simple.limit: 5` まで絞った fix PR で「実装側か Cloudflare 側か」を切り分け
- それでも engage しないなら **WAF Rate Limiting Rules (Dashboard 設定)** に切り替える。Worker binding より厳密に効く

家族用低トラフィック前提では「binding が緩めでも Observability 側で異常検知 → 後追い対処」で実害は出にくい。

### その他

- Cloudflare Dashboard で Workers の月次予算アラート (Notifications) を設定 — UI 操作のみ
- `/security-review` skill による広域レビュー (別 PR)
- (任意) Bot Fight Mode (Free プラン可) 有効化、または WAF Custom Rule で AI クローラー UA に Managed Challenge — robots.txt を無視する bot への追加層。誤検知リスクと比較して保留中

## 運用 TODO (コード変更なし)

- `INITIAL_REGISTRATION_TOKEN` は家族追加直後に `wrangler secret delete` で必ず消す (現状そうしているが手順化する)
- D1 バックアップ方針 (`wrangler d1 export` を週次で手動 or cron) をどこかに書く。table rebuild migration の直前には必ず backup を取る運用を明文化 (PR #37 の事故で露見、[ADR-005 Addendum](../adr/005-per-space-membership.md#addendum-2026-04-22-pr-4-で踏んだ-d1-cascade-事故))
