# ADR-006: 医療画像保存は R2 + Worker proxy 配信で行う

- ステータス: Accepted
- 日付: 2026-05-06
- 関連 PR: [#40](https://github.com/okayus/nyalog/pull/40) (skeleton), [#41](https://github.com/okayus/nyalog/pull/41) (CRUD), [#42](https://github.com/okayus/nyalog/pull/42) (attachments)

## 背景

猫の血液検査結果や予防接種証明など、医療系の記録に画像 / PDF を添付したい要件が出た。Cloudflare で画像を扱う選択肢:

| 選択肢                              | 月額                                                   | 自動最適化                               | 認可                                 |
| ----------------------------------- | ------------------------------------------------------ | ---------------------------------------- | ------------------------------------ |
| **R2 (オブジェクトストレージ)**     | $0 (25 GB / 5K writes / 10M reads / egress 0 まで無料) | なし                                     | private bucket + Worker proxy で柔軟 |
| **Cloudflare Images (Paid)**        | $5/月〜 (100K stored) + 配信課金                       | あり (variants 自動生成、WebP/AVIF 変換) | signed URL or Workers binding        |
| **R2 + Image Transformations Free** | $0 (5K transformations/月まで無料)                     | リサイズのみ                             | **公開オリジン前提** で認可不可      |

## 決定

**R2 一本 + Worker proxy 配信** で進める。Cloudflare Images Paid は採用しない。

## 採用理由

1. **規模感**: 家族 4 人 × 猫数頭 × 数枚/年 = R2 の無料枠 (25 GB / 月 5K writes / 10M reads / egress 0) で完全に収まる。Images Paid の月額固定 $5 は規模に対して過剰
2. **機微情報の認可**: 医療画像は private、URL を知っている誰でも見られる公開バケットには置けない。R2 を private にし、Worker が Cookie/JWT セッションで認可してから配信する形が ADR-005 の per-space 認可モデルと整合的
3. **実装の単純さ**: R2 binding は `put` / `get` / `delete` の 3 メソッドだけ。signed URL 発行や Images の variants 設計は不要
4. **Image Transformations Free の不適用**: 5K transformations/月の枠は魅力的だが、`/cdn-cgi/image/...` URL は **公開オリジン前提**。private バケット + Worker proxy には適用できない (Worker binding 経由は Images Paid 必須)

## 実装

### R2 キー設計

```
medical/<spaceId>/<catId>/<recordId>/<attachmentId>
```

- 拡張子は付けない (content-type は R2 metadata 側で持つ)
- スペース単位で prefix delete 可能 (将来の漏洩対応 / クリーンアップ時に効く)
- `attachmentId` は UUID で衝突回避

### 配信フロー

```
ブラウザ
  ↓ <img src="/api/cats/:catId/medical-records/:id/attachments/:aid">
Worker (Hono)
  ↓ ① Cookie/JWT で userId 取得 (sessionMiddleware)
  ↓ ② cats → space_id → memberSpaceIds 確認 (ADR-005)
  ↓ ③ medical_record の cat への紐づき確認
  ↓ ④ attachment の medical_record への紐づき確認
  ↓ ⑤ R2.get(r2Key)
R2 (private bucket)
  ↓ image bytes
Worker → ブラウザ (Content-Type / Cache-Control: private を付与)
```

`<img>` は同一オリジンなのでブラウザが Cookie を自動付与し、Worker 認可が透過的に効く。CSP の追加変更も不要 (`frame-src` には影響しない)。

### バリデーション (POST /attachments)

- **size**: `MAX_ATTACHMENT_SIZE_BYTES = 10 MB` (10 \* 1024 \* 1024)
- **content-type 白リスト**:
  - `image/jpeg` / `image/png` / `image/webp` / `image/heic` / `image/heif`
  - `application/pdf`
- バリデーション失敗は `attachment_too_large` (413) / `attachment_type_not_allowed` (415) と HTTP status を分けて返す

### HEIC のフロントエンド扱い

`<img>` で HEIC を表示できるブラウザは Safari 系のみで、Chrome / Firefox は限定的。受け入れ MIME には含めるが、UI 側で「インラインに表示する MIME」を `image/jpeg` / `image/png` / `image/webp` の 3 つに絞り、HEIC / HEIF / PDF はダウンロードリンク (`<a href download>`) に倒す。

### 削除時の整合性

- `DELETE /:id/attachments/:aid` — R2.delete + DB delete (best-effort、片方失敗しても処理を続ける)
- `DELETE /:id` (record 削除) — まず関連 attachments の `r2_key` を SELECT → R2 から並列 delete → DB delete (cascade で attachment 行も消える)
- `DELETE /:catId` (cat 削除) で R2 オブジェクトが orphan として残る可能性は許容 (家族規模で R2 容量に問題なし、定期掃除も将来導入で OK)

## やらなかった選択

- **Cloudflare Images Paid**: 月 $5 が規模に対して過剰。サムネイル UI が UX 上死活的になった時点で再評価
- **Image Transformations Free** (`/cdn-cgi/image/...`): 認可付きでは使えない (公開オリジン前提)
- **R2 bucket-scoped S3 token + presigned URL**: ブラウザ直アップロード/直配信のために有効だが、Worker proxy のシンプルさを上回るメリットは現状なし。家族規模では Worker 経由の egress コストはゼロ (R2 → Worker は同一プラットフォーム)
- **HEIC を transcoding して JPEG 化**: そこまで凝るなら Images Paid の方がコスパが良い

## 移行トリガー (Cloudflare Images Paid への乗り換え判断)

以下のうち 2 つ以上が同時に当てはまったら再評価:

- 家族外 (友人 / 親戚) のアカウントが増え、画像数が月 1,000 を超える
- サムネイル + 拡大の variants UI を入れたくなる
- HEIC を含むあらゆる画像をブラウザで透過的に表示したい (transcoding が要る)
- R2 ストレージが 25 GB を恒常的に超える

## 関連

- [ADR-005](./005-per-space-membership.md) — per-space 認可モデル。本 ADR の認可は ADR-005 の `memberSpaceIds` を再利用する
- [okayus-skills `cloudflare-api-token-permissions`](https://github.com/okayus/okayus-skills/pull/3) — PR #40 deploy で `CLOUDFLARE_API_TOKEN` の Workers R2 Storage / D1 権限が連鎖して欠けていた件の教訓
