---
title: SQL インジェクション — Drizzle のクエリビルダーを使い生文字列連結は禁止
impact: CRITICAL
impactDescription: DB 全件漏洩・全件削除に直結
tags: input, sql, drizzle, injection
---

## SQL インジェクション — Drizzle のクエリビルダーを使い生文字列連結は禁止

Drizzle の `eq()` や `and()` を使った通常のクエリは自動的に parameterized SQL を発行するので安全。ただし `sql` タグ付きテンプレートリテラルで生文字列を差し込むと即インジェクションになる。**ユーザー入力は必ず `sql.param()` or `${placeholder}` の束縛を経由させる**。

**Incorrect（ユーザー入力を文字列結合で差し込む）:**

```typescript
import { sql } from "drizzle-orm";

app.get("/search", async (c) => {
  const q = c.req.query("q") ?? "";
  // ❌ ${q} がそのまま SQL 文に埋め込まれる書き方をしない
  const rows = await db.run(sql.raw(`SELECT * FROM cats WHERE name LIKE '%${q}%'`));
  return c.json(rows);
});
```

**Correct（クエリビルダー or プレースホルダで束縛）:**

```typescript
import { like } from "drizzle-orm";

app.get("/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const rows = await db
    .select()
    .from(cats)
    .where(like(cats.name, `%${q}%`)); // 値はプレースホルダで渡される
  return c.json(rows);
});

// どうしても生 SQL が必要なら sql`` テンプレートリテラルで ${q} を渡す
// （${} で渡したものはプレースホルダとして扱われる）
const rows = await db.run(sql`SELECT * FROM cats WHERE name LIKE ${`%${q}%`}`);
```

補足: `sql.raw()` は文字通り生のエスケープ無し文字列なので、**ユーザー入力を絶対に渡さない**。テーブル名など構造的な要素に限定する。

参考: [Drizzle — SQL operator](https://orm.drizzle.team/docs/sql)
