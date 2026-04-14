---
title: セッション Cookie は HttpOnly + Secure + SameSite を必ず設定
impact: HIGH
impactDescription: XSS/CSRF の緩和が失われる
tags: auth, cookie, session
---

## セッション Cookie は HttpOnly + Secure + SameSite を必ず設定

セッション Cookie の属性を正しく設定しないと、XSS で JS から読めたり、CSRF でクロスサイトから送られたりする。**`HttpOnly; Secure; SameSite=Lax`（または Strict）を必ず指定する**。さらに `__Host-` プレフィックスを付けると、Secure・Path=/・Domain 無しのいずれかが欠けた Cookie をブラウザが拒否してくれる。

**Incorrect（属性未指定で `setCookie`）:**

```typescript
import { setCookie } from "hono/cookie";

setCookie(c, "nyalog_session", token); // HttpOnly も Secure も SameSite も無い
```

**Correct（nyalog の `worker/middleware/session.ts` に合わせた設定）:**

```typescript
import { setCookie } from "hono/cookie";

const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
  path: "/",
  maxAge: 30 * 24 * 60 * 60,
};

setCookie(c, "nyalog_session", token, sessionCookieOptions);

// さらに堅くしたいなら __Host- プレフィックスを使う
// （Domain 属性無し・Path=/・Secure が必須）
setCookie(c, "__Host-nyalog_session", token, sessionCookieOptions);
```

補足:
- `SameSite=Lax` でも「GET リクエストで更新処理を行う」エンドポイントがあると CSRF を防げない。副作用のある操作は POST/PUT/DELETE に限定する
- ログアウト時は `deleteCookie` で path を一致させて削除する（nyalog では `deleteCookie(c, COOKIE_NAME, { path: "/" })`）
- サブドメインに Cookie を送る設計（Domain 属性指定）は、他サブドメインの脆弱性を踏むので避ける

参考: [CookieのDomain属性は*指定しない*が一番安全](https://blog.tokumaru.org/2011/10/cookiedomain.html)
