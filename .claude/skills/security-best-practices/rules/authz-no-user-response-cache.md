---
title: ユーザー別レスポンスを CDN/KV にキャッシュしない
impact: CRITICAL
impactDescription: キャッシュから他人のデータが漏れる
tags: authz, cache, cdn, headers
---

## ユーザー別レスポンスを CDN/KV にキャッシュしない

Cloudflare Workers の前段 CDN や KV にユーザー個別のレスポンスをキャッシュすると、**別のユーザーに他人のデータが配信される事故**が起きる。認証が絡む API には必ず `Cache-Control: private, no-store` を付け、静的公開コンテンツだけを CDN キャッシュする。

**Incorrect（認証 API に public キャッシュヘッダを付けてしまう）:**

```typescript
protectedApi.get("/cats", async (c) => {
  const data = await fetchCatsForUser(c.get("userId"));
  c.header("Cache-Control", "public, max-age=60");
  return c.json(data);
});
```

**Correct（private, no-store で CDN/KV に乗せない）:**

```typescript
protectedApi.get("/cats", async (c) => {
  const data = await fetchCatsForUser(c.get("userId"));
  c.header("Cache-Control", "private, no-store");
  return c.json(data);
});
```

補足:
- Cloudflare の cache rule で Authorization/Cookie を含むリクエストをバイパスする設定も合わせて確認する
- SWR などクライアントキャッシュは問題ないが、複数ユーザーで共有される可能性のある KV / Cache API には原則置かない

参考: [docs/20260414-152659_Webサービス公開前のチェックリスト.md](../../../../docs/20260414-152659_Webサービス公開前のチェックリスト.md)
