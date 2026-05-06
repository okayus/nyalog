---
title: bot スキャン耐性 — Observability 有効化 + 未認証経路の rate limit
impact: MEDIUM
impactDescription: HTTPS で公開した瞬間に CT Log 経由でスキャン bot に晒される。コスト枯渇と検知漏れの両方が起こり得る
tags: ops, cloudflare, rate-limit, observability, bot
---

## bot スキャン耐性 — Observability 有効化 + 未認証経路の rate limit

家族限定でも、独自ドメインや `*.workers.dev` で HTTPS 公開した瞬間に **CT Log 経由でドメイン名が公開され、スキャン bot が `/.env` `/.git/config` `/admin` `/wp-login.php` に決め打ちでアクセスしてくる**。家族にしか URL を教えていなくても来る。実害は 2 種類:

1. **コスト枯渇**: 課金がリクエスト数連動 (Cloudflare Workers の有料プラン) のとき、bot の連打で Worker invocation / D1 read / Workers AI 呼び出しが浪費される
2. **検知漏れ**: そもそも bot が来ていることに気づけない — Workers Observability を有効化しないと、どのパスがどれだけ叩かれているかすら見えない

家族用の小規模アプリでも防御コストは小さいので、最初から入れておく。

**Incorrect（やりがちな状態）:**

```jsonc
// wrangler.jsonc — observability も rate limit も入れない
{
  "name": "myapp",
  "main": "./worker/index.ts",
  "d1_databases": [{ "binding": "DB", "database_name": "...", "database_id": "..." }],
  // observability なし → 攻撃を受けても気づけない
  // ratelimits なし → /api/auth/login/begin の連打で CPU が削られる
}
```

```typescript
// worker/routes/auth.ts — 未認証で叩ける begin 系に保護なし
export const authRoutes = new Hono<Env>()
  .post("/login/begin", async (c) => {
    // bot が無限連打 → 毎回 challenge 生成 (CPU + JWT 署名 + Cookie 発行)
    const options = await generateAuthenticationOptions({ rpID: c.env.RP_ID, ... });
    await issueChallenge(c, options.challenge, "authentication");
    return c.json({ options });
  });
```

**Correct（観測 + 未認証経路の rate limit を最初に入れる）:**

```jsonc
// wrangler.jsonc — observability + 未認証 auth 経路に IP 単位 rate limit
{
  "name": "myapp",
  "main": "./worker/index.ts",
  "observability": {
    "enabled": true,
    // 家族用低トラフィックなら 100% sampling で実数を取り切る (head_sampling_rate=1)
    "head_sampling_rate": 1,
  },
  "ratelimits": [
    {
      "name": "AUTH_RATE_LIMITER",
      "namespace_id": "1001", // アカウント内ユニークな整数文字列
      "simple": {
        "limit": 30,
        "period": 60, // 10 か 60 のみ許可
      },
    },
  ],
  "d1_databases": [{ "binding": "DB", "database_name": "...", "database_id": "..." }],
}
```

```typescript
// worker/middleware/rate-limit.ts — IP を key にして limit
import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

export const authRateLimit = createMiddleware<Env>(async (c, next) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const { success } = await c.env.AUTH_RATE_LIMITER.limit({ key: ip });
  if (!success) {
    return c.json({ error: { type: "rate_limited", message: "Too many requests" } }, 429);
  }
  await next();
});

// worker/types.ts — Bindings に追加
type Bindings = {
  AUTH_RATE_LIMITER: RateLimit; // RateLimit は @cloudflare/workers-types の global
  // ... 他のバインド
};

// worker/routes/auth.ts — 未認証で叩ける 4 経路に適用
export const authRoutes = new Hono<Env>()
  .post("/register/begin", authRateLimit, async (c) => { ... })
  .post("/register/verify", authRateLimit, async (c) => { ... })
  .post("/login/begin", authRateLimit, async (c) => { ... })
  .post("/login/verify", authRateLimit, async (c) => { ... });
```

## 実態を踏まえた運用判断

実装後に本番で観測した重要な事実:

- **エッジキャッシュが大半を吸収する**: `/.env` `/admin` `/wp-login.php` 等は SPA fallback で `cf-cache-status: HIT` が返り、Worker は起動しない。`curl -I` で `cf-cache-status` を確認しておくと安心
- **未認証 `/api/*` は session middleware が D1 不参照で 401 を返す**: bot が叩いても DB は消費されない。経路の存在も漏れない
- **本当に守るべきは `/api/auth/*/begin` と `/api/auth/*/verify`**: 認証前に CPU 仕事 (JWT 署名 / D1 read) が走る数少ない経路。ここだけ rate limit を当てるのが費用対効果最大
- **Workers Rate Limiting は eventually consistent**: バーストテストで 429 が出ない場合がある（[公式 docs](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) も明言）。完璧な遮断は期待せず、**Observability での異常検知 → 後追い対処** を併走させる
- **観測あっての rate limit**: `head_sampling_rate: 1` で全リクエストを構造化ログ化しておけば、bot が来ても `$workers.event.response.status` 集計で異常を検出できる

## レビュー観点

- 新規 Worker をデプロイする時、`wrangler.jsonc` に `observability.enabled` と未認証経路用の `ratelimits[]` がそろっているか
- 未認証で叩ける Hono ハンドラ (begin/verify 系、health 系、外部 webhook 受け口) を棚卸しし、CPU/IO 仕事を伴うものに rate limit middleware を当てているか
- `wrangler versions view <id>` の Bindings 一覧に `Rate Limit` 行が出ているかをデプロイ後に確認
- Workers Observability Dashboard で `$metadata.trigger` 別の集計が見えていることをデプロイから 5〜10 分後に確認

参考:
- [Cloudflare Workers Rate Limiting (binding)](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Workers Observability](https://developers.cloudflare.com/workers/observability/)
- [外部からアクセス可能な https サイトはドメイン設定後「即」攻撃にさらされる件 (Zenn)](https://zenn.dev/kusuke/articles/25330f7759eba4)
