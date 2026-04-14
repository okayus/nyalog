---
title: Strict-Transport-Security を設定して HTTPS を強制
impact: HIGH
impactDescription: HTTP 経由の通信でセッションを盗まれる
tags: header, hsts, https
---

## Strict-Transport-Security を設定して HTTPS を強制

ブラウザに「このドメインは今後 HTTPS でしかアクセスするな」と宣言するのが HSTS。中間者攻撃（カフェの Wi-Fi 等）で HTTP にダウングレードされるのを防ぐ。Cloudflare Workers では通常 HTTPS 終端されているが、ヘッダを付けてブラウザ側でも強制する。

**Incorrect（HSTS 無し）:**

```typescript
// ヘッダを何も付けない → HTTP アクセスがあり得る
```

**Correct（Hono の middleware でセキュリティヘッダをまとめて付与）:**

```typescript
import { Hono } from "hono";

const app = new Hono<Env>();

app.use("*", async (c, next) => {
  await next();
  c.header(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains; preload",
  );
});
```

補足:
- `max-age=31536000`（1 年）が一般的。初回は短めから始めて段階的に延ばすとロールバックしやすい
- `includeSubDomains` を付ける前に、本当に全サブドメインが HTTPS 化されているか確認する
- `preload` を付けると [hstspreload.org](https://hstspreload.org) に登録申請できるが、外すのが難しいので慎重に

参考: [MDN — Strict-Transport-Security](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security)
