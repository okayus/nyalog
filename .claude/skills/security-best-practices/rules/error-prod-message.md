---
title: 本番でスタックトレース・SQL・内部パスをクライアントに返さない
impact: MEDIUM-HIGH
impactDescription: 攻撃者に内部構造の地図を渡す
tags: error, production, neverthrow
---

## 本番でスタックトレース・SQL・内部パスをクライアントに返さない

AI が書いたコードは、try-catch の catch 節で `err.message` や `err.stack` をそのままレスポンスに返しがち。本番では **DB のテーブル名・ファイルパス・SQL 文・ライブラリバージョン**などが露出し、攻撃者の地図になる。neverthrow の Result 型で明示的にエラーを分類し、クライアント向けには抽象的なメッセージだけを返す。

**Incorrect（catch した例外をそのまま返す）:**

```typescript
app.post("/", async (c) => {
  try {
    const body = await c.req.json();
    await db.insert(toiletRecords).values(body);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500); // ❌ SQL 文・スタックトレース漏れ
  }
});
```

**Correct（Result 型でエラーを分類、クライアントには type だけ）:**

```typescript
type ToiletRecordError =
  | { type: "validation_error"; issues: ZodIssue[] }
  | { type: "not_found"; id: string }
  | { type: "internal_error" };

function errorResponse(err: ToiletRecordError) {
  switch (err.type) {
    case "validation_error":
      return { body: { error: { type: err.type, issues: err.issues } }, status: 400 as const };
    case "not_found":
      return { body: { error: { type: err.type } }, status: 404 as const };
    case "internal_error":
      // 詳細はサーバーログだけに残す
      return { body: { error: { type: err.type } }, status: 500 as const };
  }
}

app.post("/", async (c) => {
  const result = await createToiletRecord(c);
  if (result.isErr()) {
    if (result.error.type === "internal_error") {
      console.error("createToiletRecord failed", {
        /* 安全な context のみ */
      });
    }
    const { body, status } = errorResponse(result.error);
    return c.json(body, status);
  }
  return c.json(result.value, 201);
});
```

補足:

- フレームワークの「開発モード」と「本番モード」を切り替えるだけでエラー表示が変わるものが多い。wrangler の env で分岐する
- スタックトレースは Cloudflare のログや Sentry に送り、クライアントには送らない

参考: [docs/vibe-coding-security.md — エラーメッセージで、内部情報を漏らすな](../../../../docs/vibe-coding-security.md)
