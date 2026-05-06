---
title: 開発と本番で鍵を分け、権限を最小化する
impact: CRITICAL
impactDescription: 鍵の使い回しで漏洩の影響範囲が拡大
tags: secret, least-privilege, env
---

## 開発と本番で鍵を分け、権限を最小化する

同じ API キーを開発・ステージング・本番で使い回すと、一箇所で漏れただけで全環境が汚染される。**環境ごとに別の鍵を発行し、用途ごとに権限を最小化する**。

**Incorrect（本番の鍵をローカル `.dev.vars` にも貼る）:**

```bash
# .dev.vars
SESSION_SECRET=<本番と同じ値>
CLOUDFLARE_API_TOKEN=<Account:Admin 権限のフルアクセス鍵>
```

**Correct（開発用は dev 環境の鍵、権限はサービス単位で最小化）:**

```bash
# .dev.vars — dev 専用、本番とは別の乱数
SESSION_SECRET=$(openssl rand -hex 32)

# 本番は wrangler secret put で別値を設定
pnpm wrangler secret put SESSION_SECRET

# Cloudflare API トークンを作るときは「この Worker の deploy だけ」のように
# スコープを絞ったカスタムトークンを発行する
```

補足:

- ローテーションを前提に設計する。「漏れたらどう無効化するか」を先に決めておく
- 外部 API キーも同様。OpenAI の API キーは `sk-proj-` プロジェクト鍵で用途を分ける等
- AI エージェントが生成したコードに古い鍵が残っていないか grep で確認する

参考: [docs/vibe-coding-security.md — シークレットと鍵を、コードに書くな](../../../../docs/vibe-coding-security.md)
