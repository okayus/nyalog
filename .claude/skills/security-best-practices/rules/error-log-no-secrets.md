---
title: ログに PII・トークン・パスワードを書かない
impact: MEDIUM-HIGH
impactDescription: ログ基盤に秘密情報が漏れると取り返しがつかない
tags: error, logging, pii
---

## ログに PII・トークン・パスワードを書かない

Cloudflare Logs・Sentry・Datadog などにログを送るとき、秘密情報を出すとあとから消すのが極めて難しい。ログ用の文脈は「安全な識別子 + 状態」だけに限定し、**原則として `req.headers` / `req.body` をそのまま出さない**。

**Incorrect（エラーコンテキストに body 丸ごと）:**

```typescript
try {
  await login(body);
} catch (err) {
  console.error("login failed", { body, err }); // ❌ body.password がログに
}
```

**Correct（識別子と型だけ、秘密項目は明示的に落とす）:**

```typescript
try {
  await login(body);
} catch (err) {
  console.error("login failed", {
    email: body.email ? "***" : null, // そもそも出さない or マスク
    reason: err instanceof AuthError ? err.type : "unknown",
  });
}

// ユーティリティでホワイトリスト方式にする
function safeLog(event: string, ctx: { userId?: string; type?: string; status?: number }) {
  console.log(event, ctx);
}
```

補足:

- `Authorization` / `Cookie` / `Set-Cookie` ヘッダは原則ログに出さない
- D1 のクエリエラーには SQL 文が含まれることがある。ハンドラ側で「type: internal_error」に変換してからログに流す
- ログに書いてしまった PII は、compliance 上の削除要求（GDPR / 個人情報保護法）にも影響する

参考: [docs/vibe-coding-security.md — ログに機密情報を流すな](../../../../docs/vibe-coding-security.md)
