---
title: D1 バックアップ・2FA・予算アラート・ログ監視を有効化
impact: MEDIUM
impactDescription: 検知できないインシデントは無いのと同じ
tags: ops, backup, alerting, cloudflare
---

## D1 バックアップ・2FA・予算アラート・ログ監視を有効化

家族限定でも、データ喪失と課金事故は「1 人のミスで家族全員の記録が消える」「一晩で数万円の請求」という致命的な事故になる。インフラ側で**バックアップ・監視・アラート**を最初に設定しておく。

**Correct（最低限やっておくこと）:**

```bash
# ❶ D1 のバックアップ
# Cloudflare Dashboard → D1 → Time Travel で過去 30 日の point-in-time restore を有効化
# 重要な操作の前に手動エクスポートも取る
pnpm wrangler d1 export <DB_NAME> --output=backup-$(date +%Y%m%d).sql

# ❷ Cloudflare アカウントの 2FA
# Dashboard → My Profile → Authentication → Two-Factor Authentication を ON
# （攻撃者にアカウントを乗っ取られると全部終わる）

# ❸ 予算アラート
# Billing → Notifications で月額閾値の通知を設定
# Workers / D1 / R2 の単価と無料枠を把握した上で金額を決める

# ❹ Worker のエラーログ監視
# tail でリアルタイム確認
pnpm wrangler tail

# Logpush で R2 / 外部 SaaS にエラーログを送り、定期的に目を通す
```

補足:

- バックアップは「リストアを試したことがあるか」まで確認して初めて有効。一度は本当にリストア手順を実行してみる
- 予算アラートを設定する前にコードを書き始めない（docs/vibe-coding-security.md 第二条）
- 無料枠の落とし穴: Workers の無料枠は 1 日 10 万リクエスト。超えると有料プランに自動昇格するか、リクエストが落ちる。挙動を事前確認する

参考: [Cloudflare D1 — Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
