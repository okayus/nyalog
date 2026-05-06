---
title: API キー・秘密鍵をコードにハードコードしない
impact: CRITICAL
impactDescription: リポジトリ公開や git 履歴から漏洩
tags: secret, wrangler, env
---

## API キー・秘密鍵をコードにハードコードしない

API キー・トークン・`SESSION_SECRET` などの秘密情報をソースやプロンプトに直書きしない。git 履歴に一度でも入ると事実上取り返しがつかない。Cloudflare Workers では **`wrangler secret put` / `.dev.vars`（gitignore 済み）** を使い、コードからは `c.env.XXX` 経由で参照する。

**Incorrect（ソースに直書き / .env を commit）:**

```typescript
// worker/index.ts
const SESSION_SECRET = "super-secret-key-123"; // ❌

// .env を git add してしまう
```

**Correct（wrangler secret / .dev.vars 経由）:**

```bash
# ローカル開発: .dev.vars (gitignore 済み)
SESSION_SECRET=dev-only-random-value

# 本番: wrangler でシークレット登録
pnpm wrangler secret put SESSION_SECRET
```

```typescript
// wrangler.jsonc で vars/bindings を宣言し、型は Env に追加
type Env = {
  Bindings: {
    DB: D1Database;
    SESSION_SECRET: string;
  };
};

app.post("/auth/session", async (c) => {
  const token = await sign(payload, c.env.SESSION_SECRET); // ✅
  // ...
});
```

補足:

- `.dev.vars` / `.env*` は `.gitignore` に入っているか必ず確認
- 万が一コミットしてしまったら、鍵をローテーション（再発行）する。履歴書き換えだけでは不十分
- Claude や ChatGPT などに貼り付けるコードからも秘密を消す。AI サービスのログに残る

参考: [Cloudflare Workers — Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
