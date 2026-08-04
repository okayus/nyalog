#!/usr/bin/env node
//
// フォームコントロールの寸法・スタイルを全ビュー横断で計測する。
// CSS を触る PR で「before/after の実測を commit メッセージに残す」ための道具。
//
//   # 変更前
//   node scripts/measure-ui.mjs --out /tmp/before.json
//   # ...CSS を編集...
//   node scripts/measure-ui.mjs --out /tmp/after.json
//   node scripts/measure-ui.mjs --diff /tmp/before.json /tmp/after.json
//
// オプション:
//   --url <url>        dev サーバー (既定 http://localhost:5173。ホストからは :5473)
//   --out <path>       JSON 出力先 (既定 stdout)
//   --views a,b        計測するビューを限定 (既定 全部)
//   --theme light|dark prefers-color-scheme (既定 light)
//   --viewport WxH     既定 414x896
//   --shots <dir>      各ビューのスクリーンショットも保存
//   --diff A B         2 つの JSON を突き合わせて Markdown 表を出す (ブラウザ不要)
//   --all              --diff で変化しなかった項目も出す
//
// 前提:
//   - dev サーバーが起動していること (`pnpm dev`)
//   - DEV_BYPASS_USER_ID が効いていること (docs/local-dev.md)。AuthView が出たら中断する
//   - **before と after で dev データが同じであること。** `pnpm test:e2e` は猫を全削除するので
//     計測の途中で回さない (CLAUDE.md / docs/local-dev.md)
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// ビューへの入り方。どれも「today に戻ってから」実行する。
const VIEWS = {
  today: [],
  "cat-manager": [{ click: ".cat-manager > summary" }],
  tasks: [{ text: "タスク管理" }],
  "tasks-edit": [{ text: "タスク管理" }, { click: ".task-card-actions button" }],
  toilet: [{ text: "詳細記録" }],
  "toilet-defecation": [{ text: "詳細記録" }, { click: 'input[type="radio"][value="defecation"]' }],
  medical: [{ text: "医療記録" }],
  weight: [{ text: "体重 →" }],
  credentials: [{ text: "パスキー管理" }],
};

// 比較対象。text は行のラベルに使うだけで、差分判定には含めない
// (猫の名前など dev データ由来の文字列でノイズになるため)。
const COMPARED = [
  "w",
  "h",
  "display",
  "flexDirection",
  "alignItems",
  "gap",
  "fontSize",
  "color",
  "background",
  "border",
  "accentColor",
];

function parseArgs(argv) {
  const o = { url: "http://localhost:5173", theme: "light", viewport: "414x896", all: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--diff") o.diff = [argv[++i], argv[++i]];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--url") o.url = argv[++i];
    else if (a === "--views") o.views = argv[++i].split(",");
    else if (a === "--theme") o.theme = argv[++i];
    else if (a === "--viewport") o.viewport = argv[++i];
    else if (a === "--shots") o.shots = argv[++i];
    else if (a === "--all") o.all = true;
    else if (a === "-h" || a === "--help") o.help = true;
    else {
      console.error(`unknown option: ${a}`);
      process.exit(2);
    }
  }
  return o;
}

// ページ内で実行される。フォームコントロールを DOM 順に拾い、
// 種類ごとの連番でキーを作る (CSS 変更では DOM が動かない前提)。
function collect() {
  const round = (n) => Math.round(n * 10) / 10;
  const kindOf = (el) => (el.tagName === "INPUT" ? `input[${el.type}]` : el.tagName.toLowerCase());

  const out = {};
  const seen = {};
  for (const el of document.querySelectorAll("input, select, textarea, button, label, fieldset")) {
    const kind = kindOf(el);
    seen[kind] = (seen[kind] ?? 0) + 1;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const d = {
      w: round(r.width),
      h: round(r.height),
      display: cs.display,
      fontSize: cs.fontSize,
      color: cs.color,
      background: cs.backgroundColor,
      border: `${cs.borderTopWidth} ${cs.borderTopStyle}`,
      text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 20),
    };
    if (cs.display.includes("flex") || cs.display.includes("grid")) {
      d.flexDirection = cs.flexDirection;
      d.alignItems = cs.alignItems;
      d.gap = cs.gap;
    }
    if (el.matches('input[type="checkbox"], input[type="radio"]')) {
      // ネイティブ描画で文字を持たないので color / fontSize は見た目に出ない。
      // 拾うと「font: inherit を外した」だけで全 checkbox が差分に並び、本命が埋まる。
      delete d.color;
      delete d.fontSize;
      d.accentColor = cs.accentColor;
    }
    out[`${kind}#${seen[kind]}`] = d;
  }
  return out;
}

async function enterView(page, steps) {
  for (const step of steps) {
    if (step.click) await page.locator(step.click).first().click();
    else
      await page
        .getByRole("button", { name: new RegExp(step.text) })
        .first()
        .click();
    await page.waitForTimeout(400);
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
  if (opts.shots) mkdirSync(opts.shots, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width, height },
    colorScheme: opts.theme,
  });
  const result = { meta: { url: opts.url, theme: opts.theme, viewport: opts.viewport }, views: {} };

  try {
    for (const name of names) {
      await page.goto(opts.url, { waitUntil: "networkidle" });
      if (await page.getByRole("button", { name: /パスキーでログイン/ }).count()) {
        throw new Error(
          "AuthView が出ている。DEV_BYPASS_USER_ID と ORIGIN を .dev.vars で設定して dev サーバーを再起動する (docs/local-dev.md)",
        );
      }
      await enterView(page, VIEWS[name]);
      // ビューに入るのに押したボタンの上にポインタが残ると :hover の
      // background-color 150ms transition を計測中に拾う。逃がして落ち着かせる。
      await page.mouse.move(0, 0);
      await page.waitForTimeout(300);
      result.views[name] = await page.evaluate(collect);
      if (opts.shots) {
        await page.screenshot({ path: `${opts.shots}/${name}-${opts.theme}.png`, scale: "css" });
      }
    }
  } finally {
    await browser.close();
  }
  return result;
}

function diff(beforePath, afterPath, showAll) {
  const before = JSON.parse(readFileSync(beforePath, "utf8"));
  const after = JSON.parse(readFileSync(afterPath, "utf8"));
  const lines = [];
  let changed = 0;
  let same = 0;

  for (const view of Object.keys(before.views)) {
    const b = before.views[view] ?? {};
    const a = after.views[view] ?? {};
    const rows = [];
    for (const key of Object.keys(b)) {
      if (!(key in a)) {
        rows.push([`${key}`, "(消滅)", JSON.stringify(b[key]), "—"]);
        changed++;
        continue;
      }
      const fields = COMPARED.filter(
        (f) => JSON.stringify(b[key][f]) !== JSON.stringify(a[key][f]),
      );
      if (fields.length === 0) {
        same++;
        if (showAll) rows.push([label(key, a[key]), "—", "変化なし", `${a[key].w} x ${a[key].h}`]);
        continue;
      }
      changed++;
      for (const f of fields) rows.push([label(key, a[key]), f, fmt(b[key][f]), fmt(a[key][f])]);
    }
    for (const key of Object.keys(a)) {
      if (!(key in b)) {
        rows.push([label(key, a[key]), "(新規)", "—", `${a[key].w} x ${a[key].h}`]);
        changed++;
      }
    }
    if (rows.length === 0) continue;
    lines.push(`\n### ${view}\n`);
    lines.push("| 要素 | 項目 | before | after |");
    lines.push("| --- | --- | --- | --- |");
    for (const r of rows) lines.push(`| ${r.join(" | ")} |`);
  }

  const head = `${before.meta.theme} / ${before.meta.viewport} — 変化 ${changed} 件 / 不変 ${same} 件`;
  return [head, ...lines].join("\n");
}

const label = (key, d) => (d.text ? `${key} (${d.text})` : key);
const fmt = (v) => (v === undefined ? "—" : String(v));

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log(
    readFileSync(new URL(import.meta.url), "utf8")
      .split("\n")
      .slice(1, 27)
      .join("\n"),
  );
  process.exit(0);
}
if (opts.diff) {
  console.log(diff(opts.diff[0], opts.diff[1], opts.all));
} else {
  const result = await measure(opts);
  const json = JSON.stringify(result, null, 2);
  if (opts.out) {
    writeFileSync(opts.out, `${json}\n`);
    const n = Object.values(result.views).reduce((s, v) => s + Object.keys(v).length, 0);
    console.error(`${Object.keys(result.views).length} views / ${n} elements -> ${opts.out}`);
  } else {
    console.log(json);
  }
}
