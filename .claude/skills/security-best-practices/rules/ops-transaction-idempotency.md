---
title: 複数書き込みはトランザクションで囲み、冪等性を考慮する
impact: MEDIUM
impactDescription: 途中落ち・リトライで不整合が生まれる
tags: ops, transaction, idempotency, d1
---

## 複数書き込みはトランザクションで囲み、冪等性を考慮する

「ユーザー作成 → セッション発行 → 初期データ挿入」のような複数書き込みで、2 つ目以降がエラーになった場合、**中途半端な状態**が残る。ネットワーク断でクライアントがリトライすれば、二重作成にもなる。

- **トランザクション境界**: 「全部成功するか全部無かったことにするか」を宣言する
- **冪等性**: 「同じリクエストを 2 回実行しても結果が同じ」にする

**Incorrect（3 つの INSERT を順番に叩くだけ）:**

```typescript
app.post("/register", async (c) => {
  const db = drizzle(c.env.DB);
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, ... });        // ❶ 成功
  await db.insert(credentials).values({ id, ... });  // ❷ 失敗 → ❶ だけ残る
  await db.insert(sessions).values({ ... });         // 実行されない
  return c.json({ id });
});
```

**Correct（D1 batch でアトミックに実行、同じ requestId のリトライは無視）:**

```typescript
app.post("/register", async (c) => {
  const db = drizzle(c.env.DB);
  const requestId = c.req.header("X-Request-Id") ?? crypto.randomUUID();

  // 冪等性: 同じ requestId の既存結果があれば返す
  const existing = await db
    .select()
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, requestId));
  if (existing.length > 0) return c.json(JSON.parse(existing[0].response));

  const id = crypto.randomUUID();
  // D1 の batch は 1 トランザクション内で実行される
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO users (id, ...) VALUES (?, ...)").bind(id, ...),
    c.env.DB.prepare("INSERT INTO credentials (user_id, ...) VALUES (?, ...)").bind(id, ...),
    c.env.DB.prepare("INSERT INTO sessions (user_id, ...) VALUES (?, ...)").bind(id, ...),
    c.env.DB
      .prepare("INSERT INTO idempotency_keys (key, response) VALUES (?, ?)")
      .bind(requestId, JSON.stringify({ id })),
  ]);

  return c.json({ id });
});
```

補足:

- D1 は 1 回の `batch()` 呼び出しの内部でトランザクションになる。複数の個別 `prepare().run()` ではアトミックにならない
- UI 側の「連打防止」だけに頼らない。リトライはネットワーク断でも発生する
- 冪等性キーの TTL を決めておく（24 時間など）

参考: [D1 batch statements](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
