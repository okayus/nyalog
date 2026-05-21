import type { BloodTestValue, ValueFlag } from "../../worker/domain/blood-test-analysis";
import {
  BLOOD_TEST_CATEGORY_ORDER,
  categoryOfItemCode,
  type BloodTestCategory,
} from "../../worker/domain/blood-test-items";

// 血液検査結果の表示用ロジック。すべて純粋関数。
// WeightChart の `buildChartGeometry` と同じ思想で、後でライブラリに差し替える時は
// この .ts を入れ替えるだけで済むよう、SVG 描画は React 側に閉じる。
//
// API 設計判断: cross-attachment の集約 endpoint は作らず、既存 per-attachment
// `GET /analysis` を client で並列フェッチして item_code 軸に展開する。よって
// 入力は「analyses[]」フラットな配列を受け取って、出力は item_code 軸の Record。

// --- Input / Output Types ---

// AnalysisForDisplay: 1 回の血液検査スナップショット。`recordedAt` は
// medical_record.recorded_at (検査実施日) を使う。AI 解析開始時刻ではない。
export type AnalysisForDisplay = {
  recordedAt: string;
  values: BloodTestValue[];
};

// ある 1 項目の、ある時点での測定。
export type ItemSeriesPoint = {
  recordedAt: string;
  valueNumeric: number | null;
  valueText: string;
  unit: string | null;
  flag: ValueFlag;
  refLow: number | null;
  refHigh: number | null;
};

// item_code をキーにした時系列。配列は recordedAt 昇順。
export type ItemSeries = Record<string, ItemSeriesPoint[]>;

// 前回比の判定結果。色付け (toward=緑 / away=警告) はこの DU を見て決める。
export type Delta =
  | { kind: "no_previous" }
  | { kind: "non_numeric" }
  | { kind: "no_change" }
  | {
      kind: "change";
      delta: number;
      direction: "up" | "down";
      towardNormal: "toward" | "away" | "neutral";
    };

// 詳細チャート (popover 内) 用の geometry。
export type ChartDims = {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
};

export type ChartGeometry =
  | { kind: "empty" }
  | {
      kind: "single";
      point: { x: number; y: number; flag: ValueFlag };
      label: string;
      xAxisLabel: string;
      refBand: { y0: number; y1: number } | null;
    }
  | {
      kind: "line";
      polyline: string;
      dots: { x: number; y: number; flag: ValueFlag }[];
      xLabels: { x: number; text: string }[];
      yLabels: { y: number; text: string }[];
      refBand: { y0: number; y1: number } | null;
    };

// テーブル inline 用の極小 sparkline geometry。X 軸は時刻に比例させず
// 等間隔配置 (短期間と長期間の差で歪まないようにする)。
export type SparklineDims = { width: number; height: number };

export type SparklineGeometry =
  | { kind: "empty" }
  | { kind: "dot"; x: number; y: number; flag: ValueFlag }
  | {
      kind: "line";
      polyline: string;
      lastPoint: { x: number; y: number; flag: ValueFlag };
    };

export type CategorizedItems = {
  category: BloodTestCategory;
  items: BloodTestValue[];
};

// --- Defaults ---

const CHART_DIMS: ChartDims = {
  width: 480,
  height: 220,
  padding: { top: 20, right: 20, bottom: 40, left: 64 },
};

const SPARKLINE_DIMS: SparklineDims = { width: 60, height: 20 };

// --- Pure Functions ---

export function buildItemSeries(analyses: AnalysisForDisplay[]): ItemSeries {
  const map: ItemSeries = {};
  for (const a of analyses) {
    for (const v of a.values) {
      const point: ItemSeriesPoint = {
        recordedAt: a.recordedAt,
        valueNumeric: v.valueNumeric,
        valueText: v.valueText,
        unit: v.unit,
        flag: v.flag,
        refLow: v.refLow,
        refHigh: v.refHigh,
      };
      const existing = map[v.itemCode] ?? [];
      existing.push(point);
      map[v.itemCode] = existing;
    }
  }
  for (const code of Object.keys(map)) {
    map[code].sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : 1));
  }
  return map;
}

// 値が基準範囲からどれだけ離れているか。範囲内 (境界含む) は 0、外なら正の距離。
function distanceToRange(v: number, lo: number | null, hi: number | null): number {
  const loVal = lo ?? Number.NEGATIVE_INFINITY;
  const hiVal = hi ?? Number.POSITIVE_INFINITY;
  if (v < loVal) return loVal - v;
  if (v > hiVal) return v - hiVal;
  return 0;
}

// 前回値との差分 + 「ref に近づいたか / 離れたか」の判定。
// ref が両方 null なら towardNormal は常に "neutral" (判定不能)。
// 両方が range 内 (距離 0) なら "neutral" (正常範囲内の揺れは中立扱い)。
export function computeDelta(
  prev: ItemSeriesPoint | null,
  curr: ItemSeriesPoint,
  refLow: number | null,
  refHigh: number | null,
): Delta {
  if (prev === null) return { kind: "no_previous" };
  if (curr.valueNumeric === null || prev.valueNumeric === null) {
    return { kind: "non_numeric" };
  }

  const delta = curr.valueNumeric - prev.valueNumeric;
  if (delta === 0) return { kind: "no_change" };

  const prevDist = distanceToRange(prev.valueNumeric, refLow, refHigh);
  const currDist = distanceToRange(curr.valueNumeric, refLow, refHigh);

  let towardNormal: "toward" | "away" | "neutral";
  if (prevDist === 0 && currDist === 0) {
    towardNormal = "neutral";
  } else if (currDist < prevDist) {
    towardNormal = "toward";
  } else if (currDist > prevDist) {
    towardNormal = "away";
  } else {
    towardNormal = "neutral";
  }

  return {
    kind: "change",
    delta,
    direction: delta > 0 ? "up" : "down",
    towardNormal,
  };
}

function formatMonthDay(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function formatNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(1);
  return v.toFixed(2);
}

function padForZeroRange(v: number): number {
  return Math.max(Math.abs(v) * 0.1, 1);
}

export function buildItemChartGeometry(
  points: ItemSeriesPoint[],
  refLow: number | null,
  refHigh: number | null,
  dims: ChartDims = CHART_DIMS,
): ChartGeometry {
  const numeric = points.filter((p) => p.valueNumeric !== null);
  if (numeric.length === 0) return { kind: "empty" };

  const sorted = [...numeric].sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : 1));

  const chartW = dims.width - dims.padding.left - dims.padding.right;
  const chartH = dims.height - dims.padding.top - dims.padding.bottom;

  const values = sorted.map((p) => p.valueNumeric as number);
  const refs = [refLow, refHigh].filter((v): v is number => v !== null);
  const all = [...values, ...refs];
  const minV = Math.min(...all);
  const maxV = Math.max(...all);
  const rawRange = maxV - minV;
  const yMin = rawRange === 0 ? minV - padForZeroRange(minV) : minV - rawRange * 0.1;
  const yMax = rawRange === 0 ? maxV + padForZeroRange(maxV) : maxV + rawRange * 0.1;
  const yRange = yMax - yMin;

  const times = sorted.map((p) => new Date(p.recordedAt).getTime());
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const tRange = tMax - tMin;

  function toXY(p: ItemSeriesPoint): { x: number; y: number; flag: ValueFlag } {
    const t = new Date(p.recordedAt).getTime();
    const x =
      tRange === 0
        ? dims.padding.left + chartW / 2
        : dims.padding.left + ((t - tMin) / tRange) * chartW;
    const y = dims.padding.top + (1 - ((p.valueNumeric as number) - yMin) / yRange) * chartH;
    return { x, y, flag: p.flag };
  }

  let refBand: { y0: number; y1: number } | null = null;
  if (refLow !== null || refHigh !== null) {
    const lo = refLow ?? yMin;
    const hi = refHigh ?? yMax;
    const yLo = dims.padding.top + (1 - (lo - yMin) / yRange) * chartH;
    const yHi = dims.padding.top + (1 - (hi - yMin) / yRange) * chartH;
    refBand = { y0: yHi, y1: yLo };
  }

  if (sorted.length === 1) {
    const p = sorted[0];
    const point = toXY(p);
    const valNum = p.valueNumeric as number;
    const label = p.unit ? `${formatNumber(valNum)} ${p.unit}` : formatNumber(valNum);
    return {
      kind: "single",
      point,
      label,
      xAxisLabel: formatMonthDay(p.recordedAt),
      refBand,
    };
  }

  const xy = sorted.map(toXY);
  const polyline = xy.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const yLabels = [
    { y: dims.padding.top, text: formatNumber(yMax) },
    { y: dims.padding.top + chartH / 2, text: formatNumber((yMin + yMax) / 2) },
    { y: dims.padding.top + chartH, text: formatNumber(yMin) },
  ];

  const xLabels: { x: number; text: string }[] = [
    { x: xy[0].x, text: formatMonthDay(sorted[0].recordedAt) },
  ];
  if (sorted.length >= 3) {
    const midIdx = Math.floor(sorted.length / 2);
    xLabels.push({ x: xy[midIdx].x, text: formatMonthDay(sorted[midIdx].recordedAt) });
  }
  xLabels.push({
    x: xy[xy.length - 1].x,
    text: formatMonthDay(sorted[sorted.length - 1].recordedAt),
  });

  return { kind: "line", polyline, dots: xy, xLabels, yLabels, refBand };
}

export function buildSparklineGeometry(
  points: ItemSeriesPoint[],
  dims: SparklineDims = SPARKLINE_DIMS,
): SparklineGeometry {
  const numeric = points.filter((p) => p.valueNumeric !== null);
  if (numeric.length === 0) return { kind: "empty" };

  const sorted = [...numeric].sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : 1));
  const padding = 2;
  const chartW = dims.width - padding * 2;
  const chartH = dims.height - padding * 2;

  if (sorted.length === 1) {
    return {
      kind: "dot",
      x: padding + chartW / 2,
      y: padding + chartH / 2,
      flag: sorted[0].flag,
    };
  }

  const values = sorted.map((p) => p.valueNumeric as number);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const rawRange = maxV - minV;
  const yMin = rawRange === 0 ? minV - padForZeroRange(minV) : minV;
  const yMax = rawRange === 0 ? maxV + padForZeroRange(maxV) : maxV;
  const yRange = yMax - yMin;

  const xy = sorted.map((p, i) => ({
    x: padding + (i / (sorted.length - 1)) * chartW,
    y: padding + (1 - ((p.valueNumeric as number) - yMin) / yRange) * chartH,
    flag: p.flag,
  }));

  const polyline = xy.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const last = xy[xy.length - 1];

  return { kind: "line", polyline, lastPoint: last };
}

// 与えられた series (recordedAt 昇順) の中で、指定日時より前の最新点を返す。
// 「同 series で今回 (this attachment) より前の測定」を取り出して前回比を計算するため。
export function findPreviousPoint(
  series: ItemSeriesPoint[],
  thisRecordedAt: string,
): ItemSeriesPoint | null {
  let prev: ItemSeriesPoint | null = null;
  for (const p of series) {
    if (p.recordedAt < thisRecordedAt) prev = p;
    else break;
  }
  return prev;
}

export function groupItemsByCategory(items: BloodTestValue[]): CategorizedItems[] {
  const buckets: Partial<Record<BloodTestCategory, BloodTestValue[]>> = {};
  for (const item of items) {
    const category = categoryOfItemCode(item.itemCode);
    const list = buckets[category] ?? [];
    list.push(item);
    buckets[category] = list;
  }
  for (const cat of Object.keys(buckets) as BloodTestCategory[]) {
    const list = buckets[cat];
    if (list) list.sort((a, b) => a.rowIndex - b.rowIndex);
  }
  return BLOOD_TEST_CATEGORY_ORDER.flatMap((category) => {
    const list = buckets[category];
    return list ? [{ category, items: list }] : [];
  });
}
