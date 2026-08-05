#!/usr/bin/env node
//
// フェッチ量とレンダリング量を全ビュー横断で計測する。
// 「何件取ってきて、何ノード描いたか」を数える道具で、見た目を撮る measure-ui.mjs の対。
//
//   # 変更前
//   node scripts/measure-perf.mjs --out /tmp/perf-before.json
//   # ...実装...
//   node scripts/measure-perf.mjs --out /tmp/perf-after.json
//   node scripts/measure-perf.mjs --diff /tmp/perf-before.json /tmp/perf-after.json
//
// オプション:
//   --url <url>        dev サーバー (既定 http://localhost:5173。ホストからは :5473)
//   --out <path>       JSON 出力先 (既定 stdout)
//   --views a,b        計測するビューを限定 (既定 全部)
//   --viewport WxH     既定 414x896
//   --override <css>   計測前に流し込む CSS。1 つのルールだけを打ち消して A/B するのに使う
//   --diff A B         2 つの JSON を突き合わせて Markdown 表を出す (ブラウザ不要)
//
// CSS ルール単体の効きを見る (実装を stash せずに済むので dev サーバーの HMR と競合しない):
//   node scripts/measure-perf.mjs --views toilet --out /tmp/off.json \
//     --override '.record-item { content-visibility: visible !important }'
//   node scripts/measure-perf.mjs --views toilet --out /tmp/on.json
//   node scripts/measure-perf.mjs --diff /tmp/off.json /tmp/on.json
//
// 拾うもの:
//   - api.reqs / api.bytes / api.records — ビューに入るまでに叩いた /api/ の本数・
//     レスポンス長・配列レスポンスの要素数合計
//   - dom.nodes / dom.recordItems — DOM に居る要素の数
//   - cdp.* — CDP Performance.getMetrics の「空ページ → ビュー描画完了」の差分。
//     LayoutObjects / Nodes は決定的、Duration 系はマシン負荷で揺れるので参考値
//
// **content-visibility でスキップされた件数は JS から数えられない。** 要素や子孫の
// レイアウトを問い合わせた時点で display lock が解けてスキップが消えるので、
// checkVisibility() も getBoundingClientRect() も「全部描いた」しか返さない。
// 効きを見るのは cdp.LayoutObjects (要素を触らないグローバルカウンタ)。
//
// **api.reqs / api.records は dev の値なので本番の 2 倍出る。** StrictMode が effect を
// 二度走らせるため。before/after で同じ倍率がかかるので比率の比較には使えるが、
// 絶対値をそのまま本番の数字として書かないこと。
//
// 前提は measure-ui.mjs と同じ (dev サーバー起動済み / DEV_BYPASS_USER_ID / コンテナ内実行)。
// **before と after で dev データが同じであること。** `pnpm test:e2e` は記録を全削除する。
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

// ビューへの入り方。measure-ui.mjs の VIEWS と同じ流儀で、どれも今日の画面から始める。
const VIEWS = {
  today: [],
  toilet: [{ text: "詳細記録" }],
  weight: [{ text: "体重 →" }],
};

const CDP_METRICS = [
  "Nodes",
  "LayoutObjects",
  "LayoutCount",
  "RecalcStyleCount",
  "LayoutDuration",
  "RecalcStyleDuration",
  "ScriptDuration",
];

function parseArgs(argv) {
  const o = { url: "http://localhost:5173", viewport: "414x896" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--diff") o.diff = [argv[++i], argv[++i]];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--url") o.url = argv[++i];
    else if (a === "--views") o.views = argv[++i].split(",");
    else if (a === "--viewport") o.viewport = argv[++i];
    else if (a === "--override") o.override = argv[++i];
    else if (a === "-h" || a === "--help") o.help = true;
    else {
      console.error(`unknown option: ${a}`);
      process.exit(2);
    }
  }
  return o;
}

// ページ内で実行される。page.evaluate に渡すのでモジュールスコープは参照できない。
// 個々の要素のレイアウトは問い合わせない (content-visibility のスキップが解けるため)。
function collectDom() {
  return {
    "dom.nodes": document.getElementsByTagName("*").length,
    "dom.recordItems": document.querySelectorAll(".record-item").length,
  };
}

async function cdpSnapshot(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const out = {};
  for (const m of metrics) if (CDP_METRICS.includes(m.name)) out[m.name] = m.value;
  return out;
}

async function enterView(page, steps) {
  for (const step of steps) {
    await page
      .getByRole("button", { name: new RegExp(step.text) })
      .first()
      .click();
    await page.waitForTimeout(600);
  }
}

async function measure(opts) {
  const [width, height] = opts.viewport.split("x").map(Number);
  const names = opts.views ?? Object.keys(VIEWS);
  for (const n of names) {
    if (!VIEWS[n]) {
      console.error(`unknown view: ${n} (known: ${Object.keys(VIEWS).join(", ")})`);
      process.exit(2);
    }
  }

  const browser = await chromium.launch();
  const result = {
    meta: { url: opts.url, viewport: opts.viewport, override: opts.override ?? null },
    views: {},
  };

  try {
    for (const name of names) {
      // ビューごとに新しいページを開く。API の集計をビュー単位で切りたいので、
      // 前のビューのフェッチを持ち越さない。
      const page = await browser.newPage({ viewport: { width, height } });
      const api = { reqs: 0, bytes: 0, records: 0 };
      page.on("response", async (res) => {
        if (!new URL(res.url()).pathname.startsWith("/api/")) return;
        api.reqs++;
        const body = await res.body().catch(() => null);
        if (!body) return;
        api.bytes += body.length;
        try {
          const json = JSON.parse(body.toString());
          if (Array.isArray(json)) api.records += json.length;
        } catch {
          /* JSON でないレスポンスは件数に数えない */
        }
      });

      // アプリの CSS より後に足したいので、head へ挿すのは DOMContentLoaded 後。
      if (opts.override) {
        await page.addInitScript((css) => {
          addEventListener("DOMContentLoaded", () => {
            const style = document.createElement("style");
            style.textContent = css;
            document.head.append(style);
          });
        }, opts.override);
      }

      // 空ページの時点で採る。today は遷移ステップを持たないので、遷移前後で挟むと
      // 差が 0 になり「初期ロードで何ノード作ったか」が落ちる。
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Performance.enable");
      const before = await cdpSnapshot(cdp);

      await page.goto(opts.url, { waitUntil: "networkidle" });
      if (await page.getByRole("button", { name: /パスキーでログイン/ }).count()) {
        throw new Error(
          "AuthView が出ている。DEV_BYPASS_USER_ID と ORIGIN を .dev.vars で設定して dev サーバーを再起動する (docs/local-dev.md)",
        );
      }
      await enterView(page, VIEWS[name]);
      await page.waitForLoadState("networkidle");
      const after = await cdpSnapshot(cdp);

      const dom = await page.evaluate(collectDom);
      const view = { "api.reqs": api.reqs, "api.bytes": api.bytes, "api.records": api.records };
      Object.assign(view, dom);
      for (const m of CDP_METRICS) {
        const d = (after[m] ?? 0) - (before[m] ?? 0);
        view[`cdp.${m}`] = m.endsWith("Duration") ? Math.round(d * 1000) : d;
      }
      result.views[name] = view;
      await page.close();
    }
  } finally {
    await browser.close();
  }
  return result;
}

// 回数・バイト数は決定的なので素の差を出す。Duration はミリ秒 (丸め済み)。
function diff(beforePath, afterPath) {
  const before = JSON.parse(readFileSync(beforePath, "utf8"));
  const after = JSON.parse(readFileSync(afterPath, "utf8"));
  const lines = [];
  for (const view of Object.keys(before.views)) {
    const b = before.views[view] ?? {};
    const a = after.views[view] ?? {};
    lines.push(`\n### ${view}\n`);
    lines.push("| 指標 | before | after | 差 |");
    lines.push("| --- | --- | --- | --- |");
    for (const key of Object.keys(b)) {
      const d = (a[key] ?? 0) - b[key];
      const pct = b[key] === 0 ? "" : ` (${d > 0 ? "+" : ""}${Math.round((d / b[key]) * 100)}%)`;
      lines.push(`| ${key} | ${b[key]} | ${a[key] ?? "—"} | ${d > 0 ? "+" : ""}${d}${pct} |`);
    }
  }
  return lines.join("\n");
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log(
    readFileSync(new URL(import.meta.url), "utf8")
      .split("\n")
      .slice(1, 30)
      .join("\n"),
  );
  process.exit(0);
}
if (opts.diff) {
  console.log(diff(opts.diff[0], opts.diff[1]));
} else {
  const result = await measure(opts);
  const json = JSON.stringify(result, null, 2);
  if (opts.out) {
    writeFileSync(opts.out, `${json}\n`);
    console.error(`${Object.keys(result.views).length} views -> ${opts.out}`);
  } else {
    console.log(json);
  }
}
