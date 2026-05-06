---
title: CSP frame-ancestors でクリックジャッキングを防ぐ
impact: HIGH
impactDescription: iframe 埋め込みで操作を盗まれる
tags: header, csp, clickjacking
---

## CSP frame-ancestors でクリックジャッキングを防ぐ

悪意あるサイトが nyalog を iframe で埋め込み、透明化した上でクリックさせる「クリックジャッキング」攻撃を防ぐには、`Content-Security-Policy: frame-ancestors 'none'` を設定する。従来の `X-Frame-Options` より柔軟で、複数オリジンを許可できる。

**Incorrect（何も設定していない）:**

```typescript
// frame-ancestors 無し → どんなサイトでも iframe 埋め込み可能
```

**Correct（frame-ancestors 'none' で埋め込み禁止）:**

```typescript
app.use("*", async (c, next) => {
  await next();
  c.header("Content-Security-Policy", "frame-ancestors 'none'");
  // レガシーブラウザ向けに X-Frame-Options も併記するのが無難
  c.header("X-Frame-Options", "DENY");
});
```

補足:

- 自分自身は埋め込みを許すなら `'self'`、特定ドメインのみ許すなら `https://example.com` を列挙
- CSP は他のディレクティブ（`default-src`, `script-src` など）と一緒に設定することが多い。XSS 対策も兼ねるならセットで検討する
- `frame-ancestors` は `<meta>` では効かない。HTTP ヘッダで設定する

参考: [MDN — CSP frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/frame-ancestors)
