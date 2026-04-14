---
title: ログ・Sentry・スクリーンショットに秘密情報を含めない
impact: CRITICAL
impactDescription: 一度出力したログは消せない
tags: secret, logging, observability
---

## ログ・Sentry・スクリーンショットに秘密情報を含めない

Cloudflare のログ、Sentry、Slack 通知、エラー画面のスクリーンショットは「あとから消すのが一番難しいデータ」。トークン・パスワード・API キー・PII（個人情報）は**最初から出力しない**のが唯一の正解。

**Incorrect（リクエスト全体をそのままログに吐く）:**

```typescript
app.use(async (c, next) => {
  console.log("request", {
    url: c.req.url,
    headers: Object.fromEntries(c.req.raw.headers.entries()), // ❌ Cookie・Authorization 丸見え
    body: await c.req.text(),                                  // ❌ password / token 丸見え
  });
  await next();
});
```

**Correct（必要最小限だけ、秘密ヘッダはマスク）:**

```typescript
app.use(async (c, next) => {
  const start = Date.now();
  await next();
  console.log("request", {
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status: c.res.status,
    durationMs: Date.now() - start,
    userId: c.get("userId") ?? null, // 識別子のみ。PII は残さない
  });
});

// エラーログも同様。例外オブジェクトをそのまま送らず、whitelisted field だけ
function logError(err: unknown, context: Record<string, string | number>) {
  console.error({
    message: err instanceof Error ? err.message : String(err),
    ...context, // 呼び出し側で安全な値だけを渡す
  });
}
```

補足:
- React の error boundary が state をそのまま Sentry に送る設定になっていないか確認
- `JSON.stringify(err)` は例外オブジェクトのプロパティを全部出すことがある。DB エラーなら SQL 文が含まれうる
- 「とりあえずデバッグで出した console.log」が本番に残らないよう、lint ルールで禁止するのが楽

参考: [docs/vibe-coding-security.md — ログを残し、定期的に見ろ](../../../../docs/vibe-coding-security.md)
