---
title: ファイルアップロードは MIME・サイズ・ファイル名を全部検証
impact: CRITICAL
impactDescription: RCE・パストラバーサル・ディスク溢れ・XSS
tags: input, file-upload, path-traversal
---

## ファイルアップロードは MIME・サイズ・ファイル名を全部検証

ファイルアップロード機能は事故の宝庫。拡張子だけで判定、ファイル名をそのままパスに使う、サイズ上限なし、SVG をそのまま表示——どれも典型的な脆弱性になる。

**Incorrect（拡張子チェックだけでファイル名を素通し）:**

```typescript
app.post("/upload", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file") as File;
  if (!file.name.endsWith(".jpg")) return c.json({ error: "jpg only" }, 400);
  await c.env.BUCKET.put(`uploads/${file.name}`, file); // ../ を含むかも
  return c.json({ ok: true });
});
```

**Correct（Content-Type の allowlist・サイズ上限・サーバー側で乱数ファイル名生成）:**

```typescript
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

app.post("/upload", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "no file" }, 400);
  if (file.size > MAX_BYTES) return c.json({ error: "too large" }, 413);

  const ext = ALLOWED[file.type];
  if (!ext) return c.json({ error: "unsupported" }, 415);

  // ユーザー指定のファイル名は使わない。拡張子もサーバーが決める
  const key = `uploads/${crypto.randomUUID()}.${ext}`;
  await c.env.BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });
  return c.json({ key });
});
```

補足:
- **SVG は危険**: `image/svg+xml` は allowlist に入れない。どうしても許可するなら DOMPurify でサニタイズしてから保存
- **MIME 検証だけでは不十分**: ブラウザが送ってくる `file.type` は自己申告。信頼性を高めるならマジックバイトを読む
- **ファイル名をキーに使わない**: パストラバーサル（`../../etc/passwd`）や NTFS 代替データストリームを避けるため、サーバーで UUID を採番する

参考: [OWASP — File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
