---
title: セッショントークンは署名 + audience + DB 存在確認をセットで検証
impact: HIGH
impactDescription: いずれかを省くと認証バイパスが成立
tags: auth, session, jwt, hono
---

## セッショントークンは署名 + audience + DB 存在確認をセットで検証

JWT セッションを使うときは、**署名検証・audience 検証・DB での存在/有効期限チェック**の 3 つを必ずセットで行う。どれか 1 つでも抜けると認証バイパスになる。

- 署名だけ検証 → 別用途トークンを流用できる
- audience を見ない → パスワードリセット用トークンがセッションとして使える
- DB 存在を見ない → ログアウト済みセッションが復活する

**Incorrect（署名検証だけで信用）:**

```typescript
export function sessionMiddleware() {
  return createMiddleware<Env>(async (c, next) => {
    const token = getCookie(c, "nyalog_session");
    if (!token) return c.json({ error: "unauthorized" }, 401);
    const payload = await verify(token, c.env.SESSION_SECRET, "HS256");
    c.set("userId", payload.sub); // ❌ aud も DB も見てない
    await next();
  });
}
```

**Correct（nyalog の `worker/middleware/session.ts` と同じ構成）:**

```typescript
const SESSION_AUD = "nyalog:session";

export function sessionMiddleware() {
  return createMiddleware<Env>(async (c, next) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token) return c.json({ error: { type: "unauthorized" } }, 401);

    // ❶ 署名検証
    let payload: SessionPayload;
    try {
      payload = (await verify(token, c.env.SESSION_SECRET, "HS256")) as SessionPayload;
    } catch {
      return c.json({ error: { type: "unauthorized" } }, 401);
    }
    // ❷ audience 検証 — 別用途トークンを弾く
    if (payload.aud !== SESSION_AUD) {
      return c.json({ error: { type: "unauthorized" } }, 401);
    }
    // ❸ DB でセッションの存在・有効期限を確認
    const db = drizzle(c.env.DB);
    const rows = await db.select().from(sessions).where(eq(sessions.id, payload.sid));
    if (rows.length === 0 || new Date(rows[0].expiresAt).getTime() < Date.now()) {
      deleteCookie(c, COOKIE_NAME, { path: "/" });
      return c.json({ error: { type: "session_expired" } }, 401);
    }
    c.set("userId", rows[0].userId);
    await next();
  });
}
```

補足:

- dev bypass（`DEV_BYPASS_USER_ID` など）は本番 env で絶対に有効にしない。wrangler の env 分岐を確認する
- セッション失効後もトークンだけは手元に残るので、DB 側の削除と Cookie 削除を同時に行う

参考: [nyalog `worker/middleware/session.ts`](../../../../packages/web/worker/middleware/session.ts)
