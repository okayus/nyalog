---
title: UPDATE/DELETE の WHERE に所有者条件を必ず含める
impact: CRITICAL
impactDescription: WHERE 漏れは全件更新/削除の事故に直結
tags: authz, drizzle, sql, update, delete
---

## UPDATE/DELETE の WHERE に所有者条件を必ず含める

Drizzle の `db.update()` / `db.delete()` は、`.where()` を忘れると**全件に影響する**。AI は「直前で existence チェックをしているから大丈夫」と思い込んで WHERE を id だけにしがちだが、Time-of-check to time-of-use (TOCTOU) や条件の書き漏れで事故になる。**書き込み系の WHERE には必ず「ID + 所有者条件」の両方を入れる**。

**Incorrect（存在チェックは所有者込みだが、update は id だけ）:**

```typescript
// 直前に所有者込みで存在確認
const existing = await db
  .select()
  .from(toiletRecords)
  .where(and(eq(toiletRecords.id, id), eq(toiletRecords.catId, catId)));
if (existing.length === 0) return c.json({ error: "not found" }, 404);

// ❌ update の WHERE は id だけ
await db.update(toiletRecords).set(updates).where(eq(toiletRecords.id, id));
```

**Correct（update / delete の WHERE にも所有者条件を入れる）:**

```typescript
await db
  .update(toiletRecords)
  .set(updates)
  .where(and(eq(toiletRecords.id, id), eq(toiletRecords.catId, catId)));

await db.delete(toiletRecords).where(and(eq(toiletRecords.id, id), eq(toiletRecords.catId, catId)));
```

補足: 所有者条件を入れておけば、仮に attacker が他人の id を推測して直接 API を叩いても更新は 0 件で終わる。「select して in-memory でチェック → update」のパターンは、WHERE を二重に書くのが面倒でも必ず守る。

参考: [docs/20260414-152659_Webサービス公開前のチェックリスト.md](../../../../docs/20260414-152659_Webサービス公開前のチェックリスト.md)
