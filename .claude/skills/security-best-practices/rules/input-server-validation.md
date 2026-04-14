---
title: 入力バリデーションは必ずサーバー側 (Zod) で行う
impact: CRITICAL
impactDescription: クライアント検証はセキュリティ境界にならない
tags: input, validation, zod, hono
---

## 入力バリデーションは必ずサーバー側 (Zod) で行う

React フォームの `required`、zod の `resolver`、HTML の `maxlength` はすべて UX 補助でしかない。攻撃者は devtools や curl で API を直接叩ける。**Hono ハンドラで必ず Zod スキーマを実行し、Result 型で失敗を明示的に扱う**。

**Incorrect（サーバー側で型をそのまま信用する）:**

```typescript
app.post("/", async (c) => {
  const body = await c.req.json();
  // body.timestamp は string? それとも number? 長さ制限は?
  await db.insert(toiletRecords).values({
    id: crypto.randomUUID(),
    catId: c.req.param("catId"),
    type: body.type,
    timestamp: body.timestamp,
    condition: body.condition,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return c.json({ ok: true });
});
```

**Correct（Zod スキーマで検証し、Result 型で失敗を分岐）:**

```typescript
const CreateToiletRecord = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("urination"),
    timestamp: z.string().datetime(),
  }),
  z.object({
    type: z.literal("defecation"),
    timestamp: z.string().datetime(),
    condition: z.enum(["normal", "soft", "diarrhea", "hard", "bloody"]),
  }),
]);

app.post("/", async (c) => {
  const parsed = CreateToiletRecord.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json(
      { error: { type: "validation_error", issues: parsed.error.issues } },
      400,
    );
  }
  // 以降、parsed.data は型付きで安全に扱える
});
```

補足: CLAUDE.md に従い、ドメイン境界では `parseXxx(input): Result<T, E>` のように neverthrow の Result を返す関数に閉じ込めると、ハンドラが小さく保てる。

参考: [Zod](https://zod.dev)
