---
title: IDOR 対策 — リソース取得は常に所有者条件を含める
impact: CRITICAL
impactDescription: 認可漏れは個人情報漏洩に直結
tags: authz, idor, drizzle, hono
---

## IDOR 対策 — リソース取得は常に所有者条件を含める

URL のパスパラメータで ID を受けてリソースを取得するとき、ID だけで引くと他人のリソースが見える。必ず「そのリソースは現在認証しているユーザー（および猫）のものか」を DB クエリの WHERE で検証する。「URL に ID が入ってるんだから本人しか見ないでしょ」という性善説は通じない。

**Incorrect（ID だけで取得 → 他家族の猫の記録が見える）:**

```typescript
app.get("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = c.req.param("id");
  const rows = await db.select().from(toiletRecords).where(eq(toiletRecords.id, id));
  if (rows.length === 0) return c.json({ error: "not found" }, 404);
  return c.json(rows[0]);
});
```

**Correct（owner の catId で必ず絞り込む）:**

```typescript
app.get("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId");
  const catId = c.req.param("catId");
  const id = c.req.param("id");

  // cat が userId のものか、toiletRecord が catId のものかを両方 WHERE に入れる
  const rows = await db
    .select()
    .from(toiletRecords)
    .where(and(eq(toiletRecords.id, id), eq(toiletRecords.catId, catId)));
  if (rows.length === 0) return c.json({ error: "not found" }, 404);
  return c.json(rows[0]);
});
```

所有関係が多段（user → cat → toiletRecord）の場合は、全段の所有を検証する。中間リソース（cat）の所有確認を省くと、他人の cat に自分の toiletRecord を紐付ける攻撃が成立することがある。

参考: [OWASP — Insecure Direct Object Reference](https://portswigger.net/web-security/access-control/idor)
