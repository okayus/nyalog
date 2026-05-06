---
title: AI が提案したパッケージは実在・メンテ・ライセンスを確認してから追加
impact: MEDIUM
impactDescription: ハルシネーションとタイポスクワッティングの両方に対処
tags: deps, npm, supply-chain
---

## AI が提案したパッケージは実在・メンテ・ライセンスを確認してから追加

AI は存在しないパッケージ名を堂々と提案することがある（ハルシネーション）。また、攻撃者が「AI がよく間違える名前」で悪意あるパッケージを npm に先行登録している事例もある（タイポスクワッティング）。**`pnpm add` する前に最低限の身元確認**をする。

**Incorrect（提案されたまま pnpm add）:**

```bash
# AI: "toilet-record-utils を使えばできます"
pnpm add toilet-record-utils  # ❌ 実在確認もメンテ確認もしていない
```

**Correct（npm/GitHub で実在・メンテ・ライセンスを確認）:**

```bash
# ❶ npm に実在するか確認
pnpm view some-package

# ❷ GitHub リポジトリを開き
#    - 最終コミットが直近 1 年以内か
#    - スター数・Issue 数・PR の応答が健全か
#    - メンテナが複数か
#    - ライセンスが MIT / Apache-2.0 など商用利用 OK か
#    - package.json の dependencies が妥当か（怪しいパッケージを含まない）
#    - types が提供されているか

# ❸ 問題なければ正確な名前でバージョン固定付きで追加
pnpm add some-package@1.2.3

# ❹ pnpm-lock.yaml を必ずコミット
git add package.json pnpm-lock.yaml
```

補足:

- 公式っぽい名前でも、似たスコープ（`@faker-js/faker` vs `faker` 等）の乗っ取り事例がある
- `pnpm audit` / `pnpm outdated` を CI で定期実行して脆弱性を早期発見する
- 本当にそのライブラリが必要か、標準ライブラリ / Hono / React の既存機能で足りないかを先に検討する

参考: [docs/vibe-coding-security.md — AIが提案するライブラリを、鵜呑みにするな](../../../../docs/vibe-coding-security.md)
