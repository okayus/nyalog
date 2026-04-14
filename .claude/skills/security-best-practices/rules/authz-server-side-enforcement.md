---
title: 権限チェックはサーバー側で必ず再実施する
impact: CRITICAL
impactDescription: フロント隠しはセキュリティにならない
tags: authz, hono, react
---

## 権限チェックはサーバー側で必ず再実施する

React で「管理者にだけボタンを表示する」「オーナーでなければ編集画面に入れない」といった制御をしても、それは UX 上の導線にすぎない。攻撃者はブラウザの devtools で JS を書き換えたり、API を直接叩いたりできる。**権限判定は必ず Hono ハンドラ側で再実施する**。

**Incorrect（API ハンドラでの権限チェックがなく、フロント隠しだけに頼る）:**

```typescript
// frontend
{isOwner && <button onClick={deleteCat}>削除</button>}

// backend — owner チェックなし
app.delete("/cats/:id", async (c) => {
  const db = drizzle(c.env.DB);
  await db.delete(cats).where(eq(cats.id, c.req.param("id")));
  return c.json({});
});
```

**Correct（backend でも所有者を必ず確認）:**

```typescript
app.delete("/cats/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const userId = c.get("userId");
  const id = c.req.param("id");

  const owned = await db
    .select({ id: cats.id })
    .from(cats)
    .where(and(eq(cats.id, id), eq(cats.ownerId, userId)));
  if (owned.length === 0) return c.json({ error: "not found" }, 404);

  await db.delete(cats).where(and(eq(cats.id, id), eq(cats.ownerId, userId)));
  return c.json({});
});
```

補足: 「404 を返すか 403 を返すか」は情報漏洩を避けるなら 404 のほうが無難。他家族のリソースがあることを露呈しない。

参考: [docs/vibe-coding-security.md — 「ログインできる」と「他人のデータが見えない」は別物だ](../../../../docs/vibe-coding-security.md)
