#!/usr/bin/env node
//
// 計測用に、本番規模のトイレ記録と体重記録をローカル D1 へ撒く。
//
//   node scripts/dev-seed-bulk.mjs                 # しらたま 900 / おかゆ 320 件
//   node scripts/dev-seed-bulk.mjs --records 2000  # 件数を変える
//   node scripts/dev-seed-bulk.mjs --sql-only /tmp/x.sql   # 流さず SQL だけ書き出す
//
// dev-seed.sql は「記録は画面から作る想定」で記録を入れていない。一方で
// フェッチ量やレンダリング量を測る PR (docs/plans/frontend-improvements.md の
// 計画 3 以降) では本番規模のデータが要る。毎回その場でジェネレータを書き捨てて
// いたのでスクリプトにした。
//
// - **--local 固定。** 本番 D1 には絶対に流さない (--remote を受け付けない)
// - 消すのは dev の猫 2 匹の記録だけ。cross-space の fixture (other-cat) は残す
// - 擬似乱数は固定 seed。同じ引数なら何度流しても同じ形になる (件数と分布が変わると
//   before/after が比較できなくなるため)
// - タイムスタンプは実行時刻からの相対。日付をまたいだら撒き直す (「今日」の
//   件数が変わって today ビューの計測がずれる)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";

const DEV_CATS = [
  { id: "bbbbbbbb-0000-4000-8000-000000000001", name: "しらたま", share: 1 },
  { id: "bbbbbbbb-0000-4000-8000-000000000002", name: "おかゆ", share: 320 / 900 },
];
const DEV_USER = "00000000-0000-4000-8000-000000000000";
const CONDITIONS = ["normal", "soft", "diarrhea", "hard", "bloody"];

function parseArgs(argv) {
  const o = { records: 900, weights: 50 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--records") o.records = Number(argv[++i]);
    else if (a === "--weights") o.weights = Number(argv[++i]);
    else if (a === "--sql-only") o.sqlOnly = argv[++i];
    else if (a === "-h" || a === "--help") o.help = true;
    else {
      console.error(`unknown option: ${a}`);
      process.exit(2);
    }
  }
  return o;
}

function buildSql({ records, weights }) {
  // 固定 seed の線形合同法。Math.random() だと撒くたびに分布が変わる。
  let seed = 20260804;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  const ids = DEV_CATS.map((c) => `'${c.id}'`).join(",");
  const lines = [
    `DELETE FROM toilet_records WHERE cat_id IN (${ids});`,
    `DELETE FROM weight_records WHERE cat_id IN (${ids});`,
  ];
  const now = Date.now();

  for (const cat of DEV_CATS) {
    const n = Math.round(records * cat.share);
    const values = [];
    for (let i = 0; i < n; i++) {
      // 4 時間おき + 1 時間以内のゆらぎ。i=0 が直近。
      const ts = new Date(now - i * 4 * 3600000 - Math.floor(rnd() * 3600000)).toISOString();
      const defecation = i % 4 === 3;
      const condition = defecation ? `'${CONDITIONS[i % CONDITIONS.length]}'` : "NULL";
      const type = defecation ? "defecation" : "urination";
      values.push(
        `('${crypto.randomUUID()}','${cat.id}','${type}','${ts}',${condition},'${DEV_USER}','${ts}','${ts}')`,
      );
    }
    // D1 は 1 文が長すぎると通らないので 200 件ずつに割る
    for (let i = 0; i < values.length; i += 200) {
      lines.push(
        `INSERT INTO toilet_records(id,cat_id,type,timestamp,condition,created_by,created_at,updated_at) VALUES ${values.slice(i, i + 200).join(",")};`,
      );
    }

    const w = [];
    for (let i = 0; i < Math.round(weights * cat.share); i++) {
      const at = new Date(now - i * 14 * 86400000).toISOString();
      w.push(
        `('${crypto.randomUUID()}','${cat.id}',${4200 + Math.floor(rnd() * 600)},'${at}','${DEV_USER}','${at}','${at}')`,
      );
    }
    if (w.length > 0) {
      lines.push(
        `INSERT INTO weight_records(id,cat_id,weight_grams,measured_at,created_by,created_at,updated_at) VALUES ${w.join(",")};`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log(
    readFileSync(new URL(import.meta.url), "utf8")
      .split("\n")
      .slice(1, 16)
      .join("\n"),
  );
  process.exit(0);
}

const sql = buildSql(opts);
if (opts.sqlOnly) {
  writeFileSync(opts.sqlOnly, sql);
  console.error(`-> ${opts.sqlOnly}`);
  process.exit(0);
}

const tmp = `/tmp/dev-seed-bulk-${process.pid}.sql`;
writeFileSync(tmp, sql);
try {
  // --local 固定。--remote は受け付けない (本番 D1 を潰さないため)。
  execFileSync(
    "./node_modules/.bin/wrangler",
    ["d1", "execute", "nyalog-db", "--local", "--file", tmp],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  const total = DEV_CATS.map((c) => `${c.name} ${Math.round(opts.records * c.share)}`).join(" / ");
  console.error(`撒いた (トイレ記録): ${total}`);
} finally {
  unlinkSync(tmp);
}
