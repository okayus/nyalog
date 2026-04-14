---
title: dangerouslySetInnerHTML を使う前にサニタイズする
impact: CRITICAL
impactDescription: XSS で認証情報漏洩・任意操作
tags: input, xss, react, sanitize
---

## dangerouslySetInnerHTML を使う前にサニタイズする

React は JSX の `{text}` を自動でエスケープするので、ユーザー入力をそのまま描画する限り XSS にはならない。しかし `dangerouslySetInnerHTML` を使うとエスケープがバイパスされる。**どうしても HTML をレンダリングする必要がある場合は、DOMPurify などで事前にサニタイズする**。

**Incorrect（ユーザー入力をそのまま HTML としてレンダリング）:**

```typescript
function Memo({ memo }: { memo: string }) {
  return <div dangerouslySetInnerHTML={{ __html: memo }} />;
}
```

**Correct（可能な限り平文レンダリング、必要なら DOMPurify でサニタイズ）:**

```typescript
// ❶ まず「本当に HTML が必要か」を検討し、不要ならプレーンテキストで表示する
function Memo({ memo }: { memo: string }) {
  return <div>{memo}</div>;
}

// ❷ Markdown を表示したいなら、react-markdown のようにエスケープ済みのライブラリを使う
import Markdown from "react-markdown";
function Memo({ memo }: { memo: string }) {
  return <Markdown>{memo}</Markdown>;
}

// ❸ どうしても HTML 文字列を描画するなら DOMPurify でサニタイズ
import DOMPurify from "isomorphic-dompurify";
function Memo({ html }: { html: string }) {
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  return <div dangerouslySetInnerHTML={{ __html: clean }} />;
}
```

補足: SVG 画像をそのまま `<img>` で表示するだけでも、内部の `<script>` が XSS の温床になりうる。SVG は別オリジンで配信するか、サニタイズしてから表示する。

参考: [DOMPurify](https://github.com/cure53/DOMPurify)
