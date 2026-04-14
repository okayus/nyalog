---
title: ユーザー入力をレスポンスヘッダに直接入れない
impact: HIGH
impactDescription: CRLF インジェクションで任意ヘッダ・XSS
tags: header, crlf-injection
---

## ユーザー入力をレスポンスヘッダに直接入れない

ユーザーが指定した値（リダイレクト先、ファイル名、カスタムヘッダ）を検証せずレスポンスヘッダに入れると、`\r\n` を含む値で「ヘッダ終了 + 新しいヘッダ注入」ができてしまう（CRLF インジェクション）。本文にスクリプトを注入されて XSS に発展することもある。

**Incorrect（クエリパラメータをそのまま Location に）:**

```typescript
app.get("/redirect", (c) => {
  const target = c.req.query("to") ?? "/";
  c.header("Location", target); // "/%0D%0ASet-Cookie: evil=1" を食わせると任意ヘッダ
  return c.body(null, 302);
});

// ダウンロードファイル名をユーザーがコントロール
app.get("/download", (c) => {
  const name = c.req.query("name") ?? "file";
  c.header("Content-Disposition", `attachment; filename=${name}`); // CRLF 注入可能
  return c.body(data);
});
```

**Correct（許可リスト + allowlist 文字 + encodeURIComponent）:**

```typescript
app.get("/redirect", (c) => {
  const raw = c.req.query("to") ?? "/";
  // 相対パスだけ許す（//evil.com のようなプロトコル相対は拒否）
  const safe = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  return c.redirect(safe);
});

app.get("/download", (c) => {
  const raw = c.req.query("name") ?? "file";
  // 英数字・ハイフン・アンダースコア・ドットに限定
  const safe = raw.replace(/[^\w.-]/g, "_");
  c.header(
    "Content-Disposition",
    `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
  );
  return c.body(data);
});
```

補足: Hono や modern フレームワークはヘッダ値の CRLF を弾くことがあるが、**ミドルウェアや下位ライブラリによってはそのまま通る**。入力検証は自分で書く前提でいる。

参考: [OWASP — HTTP Response Splitting](https://owasp.org/www-community/attacks/HTTP_Response_Splitting)
