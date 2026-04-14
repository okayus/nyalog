# nyalog Security Best Practices

nyalog（家族限定の猫ケア管理 Web アプリ）実装時に参照するセキュリティガイドを、エージェント/LLM 向けに構造化したリポジトリ。

## 構成

- `rules/` — 個別ルールファイル（1 ルール 1 ファイル）
  - `_sections.md` — セクションメタデータ（タイトル・Impact・説明）
  - `_template.md` — 新規ルール作成テンプレート
  - `<prefix>-<name>.md` — 個別ルール
- `metadata.json` — ドキュメントメタデータ（version, abstract）
- `SKILL.md` — Skill エントリポイント（クイックリファレンス）
- `AGENTS.md` — 全ルールを展開した完全ドキュメント

## 新しいルールを追加する

1. `rules/_template.md` を `rules/<prefix>-<short-description>.md` にコピー
2. prefix はセクションに対応:
   - `authz-` — 認可・データアクセス制御 (Section 1)
   - `input-` — 入力バリデーション (Section 2)
   - `secret-` — シークレット・鍵管理 (Section 3)
   - `auth-` — 認証・セッション (Section 4)
   - `header-` — レスポンスヘッダ (Section 5)
   - `error-` — エラーハンドリング・ログ (Section 6)
   - `deps-` — 依存ライブラリ (Section 7)
   - `ops-` — 運用・バックアップ (Section 8)
3. frontmatter と本文を埋める
4. Incorrect / Correct のコード例を必ず含める（nyalog の実スタック: Hono/React/Drizzle/Zod/neverthrow に合わせる）
5. `SKILL.md` のクイックリファレンスと `AGENTS.md` を手動で更新する

## ルールファイルの構造

```markdown
---
title: ルールタイトル
impact: CRITICAL
impactDescription: 任意の影響度説明
tags: tag1, tag2
---

## ルールタイトル

ルールの簡潔な説明と、なぜ重要かを書く。

**Incorrect（何がダメか）:**

\`\`\`typescript
// 脆弱なコード例
\`\`\`

**Correct（正しい書き方）:**

\`\`\`typescript
// 安全なコード例
\`\`\`

必要なら補足説明を書く。

参考: [Link](https://example.com)
```

## Impact レベル

- `CRITICAL` — 最優先。個人情報漏洩・認可バイパスなど致命的な事故に直結
- `HIGH` — 重大。セッション乗っ取り・クリックジャッキングなど
- `MEDIUM-HIGH` — やや重い影響
- `MEDIUM` — 中程度。事故の温床になりうる
- `LOW-MEDIUM` / `LOW` — 低

## 命名規則

- `_` で始まるファイルは特殊（セクション定義・テンプレ）
- ルールファイル: `<prefix>-<short-description>.md`
- セクションはファイル名の prefix から自動的に判別
- タイトルは日本語 OK

## 参考資料

- `docs/vibe-coding-security.md`（プロジェクト内）
- `docs/20260414-152659_Webサービス公開前のチェックリスト.md`（プロジェクト内）
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
