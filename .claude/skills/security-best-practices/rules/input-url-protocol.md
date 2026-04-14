---
title: ユーザー指定 URL はプロトコル制限 + 許可リスト方式で検証
impact: CRITICAL
impactDescription: javascript: スキームやオープンリダイレクトで XSS・誘導攻撃
tags: input, url, xss, open-redirect
---

## ユーザー指定 URL はプロトコル制限 + 許可リスト方式で検証

ユーザーが入力した URL をリンクやリダイレクトに使うとき、`https:` 以外を許すと `javascript:alert(1)` のような URL で XSS になる。リダイレクト先を URL パラメータで受ける場合は、許可したドメインに絞らないとオープンリダイレクトになり、フィッシングの踏み台にされる。

**Incorrect（プロトコルも遷移先もノーチェック）:**

```typescript
// React
<a href={user.websiteUrl}>ウェブサイト</a>

// Hono
app.get("/login", (c) => {
  const redirect = c.req.query("redirect_to") ?? "/";
  return c.redirect(redirect);
});
```

**Correct（プロトコルを `https:` に限定、redirect_to は相対 path のみ）:**

```typescript
function safeExternalUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// React
const href = safeExternalUrl(user.websiteUrl);
return href ? <a href={href} rel="noopener noreferrer">ウェブサイト</a> : null;

// Hono — redirect_to は「/」で始まる相対パスのみ
app.get("/login", (c) => {
  const raw = c.req.query("redirect_to") ?? "/";
  const redirect = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  return c.redirect(redirect);
});
```

補足: 正規表現で URL を判定する場合、文頭/文末チェック漏れやマルチラインフラグのバイパスに注意する。`URL` コンストラクタで `protocol` を見るのが最も確実。

参考: [正規表現を用いたURLチェックをバイパスする際の観点](https://www.mbsd.jp/research/20230210/regex-url/)
