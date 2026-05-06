---
title: X-Content-Type-Options nosniff を設定
impact: HIGH
impactDescription: MIME sniffing で JS として解釈される
tags: header, mime, xss
---

## X-Content-Type-Options nosniff を設定

ブラウザが Content-Type を勝手に推測（MIME sniffing）して、サーバーが `text/plain` で返したファイルを `application/javascript` として実行してしまうことがある。`X-Content-Type-Options: nosniff` を付けると、サーバーが宣言した Content-Type を強制させられる。

**Incorrect（nosniff なし）:**

```typescript
// ユーザーがアップロードしたファイルを text/plain で返す
// → ブラウザが勝手に JS として実行することがある
```

**Correct（全レスポンスに nosniff を付与）:**

```typescript
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
});
```

補足:

- IE 時代の話に見えるが、最新ブラウザでも必要。Chrome/Firefox もこのヘッダが無いと一部の MIME sniffing を行う
- `Content-Type` 自体を正しく設定することが前提。JSON API なら `application/json`、画像なら実際の形式に合わせる
- セキュリティヘッダ系は 1 つずつ付けるより、`hono/secure-headers` のミドルウェアでまとめて付けるほうがもれにくい

参考: [X-Content-Type-Options: nosniff はIE以外にも必要](https://blog.ohgaki.net/x-content-type-options-nosniff-is-required-by-other-than-ie)
