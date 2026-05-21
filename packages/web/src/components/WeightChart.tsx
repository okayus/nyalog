import type { ThemeColor } from "../../worker/domain/cat";

export type WeightChartPoint = {
  measuredAt: string;
  weightGrams: number;
};

export type WeightChartProps = {
  data: WeightChartPoint[];
  themeColor?: ThemeColor;
  ariaLabel?: string;
};

// 後でライブラリに差し替える時はこのファイルだけ置き換えればよいよう、
// 描画ロジック (純粋関数) と React 表示を分離している。
// props は JSON-serializable な最小データ + theme のみ。

type Dimensions = {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
};

type Geometry =
  | { kind: "empty" }
  | {
      kind: "single";
      point: { x: number; y: number };
      label: string;
      xAxisLabel: string;
    }
  | {
      kind: "line";
      polyline: string;
      dots: { x: number; y: number }[];
      xLabels: { x: number; text: string }[];
      yLabels: { y: number; text: string }[];
    };

const DIMS: Dimensions = {
  width: 600,
  height: 240,
  padding: { top: 20, right: 20, bottom: 40, left: 64 },
};

function formatMonthDay(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}

function formatKg(grams: number): string {
  return `${(grams / 1000).toFixed(2)} kg`;
}

export function buildChartGeometry(data: WeightChartPoint[], dims: Dimensions = DIMS): Geometry {
  if (data.length === 0) return { kind: "empty" };

  const sorted = [...data].sort((a, b) => (a.measuredAt < b.measuredAt ? -1 : 1));
  const chartW = dims.width - dims.padding.left - dims.padding.right;
  const chartH = dims.height - dims.padding.top - dims.padding.bottom;

  const weights = sorted.map((p) => p.weightGrams);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const rawRange = maxW - minW;
  // 全値が同じ場合は ±100g のレンジを与えて点が中央に来るようにする
  const yMin = rawRange === 0 ? minW - 100 : minW - rawRange * 0.1;
  const yMax = rawRange === 0 ? maxW + 100 : maxW + rawRange * 0.1;
  const yRange = yMax - yMin;

  const times = sorted.map((p) => new Date(p.measuredAt).getTime());
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const tRange = tMax - tMin;

  function toXY(p: WeightChartPoint): { x: number; y: number } {
    const t = new Date(p.measuredAt).getTime();
    const x =
      tRange === 0
        ? dims.padding.left + chartW / 2
        : dims.padding.left + ((t - tMin) / tRange) * chartW;
    const y = dims.padding.top + (1 - (p.weightGrams - yMin) / yRange) * chartH;
    return { x, y };
  }

  if (sorted.length === 1) {
    return {
      kind: "single",
      point: toXY(sorted[0]),
      label: formatKg(sorted[0].weightGrams),
      xAxisLabel: formatMonthDay(sorted[0].measuredAt),
    };
  }

  const xy = sorted.map(toXY);
  const polyline = xy.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const yLabels = [
    { y: dims.padding.top, text: formatKg(yMax) },
    { y: dims.padding.top + chartH / 2, text: formatKg((yMin + yMax) / 2) },
    { y: dims.padding.top + chartH, text: formatKg(yMin) },
  ];

  const xLabels: { x: number; text: string }[] = [
    { x: xy[0].x, text: formatMonthDay(sorted[0].measuredAt) },
  ];
  if (sorted.length >= 3) {
    const midIdx = Math.floor(sorted.length / 2);
    xLabels.push({ x: xy[midIdx].x, text: formatMonthDay(sorted[midIdx].measuredAt) });
  }
  xLabels.push({
    x: xy[xy.length - 1].x,
    text: formatMonthDay(sorted[sorted.length - 1].measuredAt),
  });

  return { kind: "line", polyline, dots: xy, xLabels, yLabels };
}

export function WeightChart({ data, themeColor, ariaLabel }: WeightChartProps) {
  const geo = buildChartGeometry(data);
  const chartLeft = DIMS.padding.left;
  const chartRight = DIMS.width - DIMS.padding.right;
  const chartTop = DIMS.padding.top;
  const chartBottom = DIMS.height - DIMS.padding.bottom;

  return (
    <div className="weight-chart" data-cat-theme={themeColor}>
      <svg
        role="img"
        aria-label={ariaLabel ?? "体重推移グラフ"}
        viewBox={`0 0 ${DIMS.width} ${DIMS.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* 軸 */}
        <line
          x1={chartLeft}
          y1={chartTop}
          x2={chartLeft}
          y2={chartBottom}
          className="weight-chart-axis"
        />
        <line
          x1={chartLeft}
          y1={chartBottom}
          x2={chartRight}
          y2={chartBottom}
          className="weight-chart-axis"
        />

        {geo.kind === "empty" ? (
          <text
            x={DIMS.width / 2}
            y={DIMS.height / 2}
            textAnchor="middle"
            className="weight-chart-empty"
          >
            記録なし
          </text>
        ) : null}

        {geo.kind === "single" ? (
          <>
            <circle cx={geo.point.x} cy={geo.point.y} r={5} className="weight-chart-dot" />
            <text
              x={geo.point.x}
              y={geo.point.y - 12}
              textAnchor="middle"
              className="weight-chart-value"
            >
              {geo.label}
            </text>
            <text
              x={geo.point.x}
              y={chartBottom + 18}
              textAnchor="middle"
              className="weight-chart-tick"
            >
              {geo.xAxisLabel}
            </text>
          </>
        ) : null}

        {geo.kind === "line" ? (
          <>
            <polyline points={geo.polyline} fill="none" className="weight-chart-line" />
            {geo.dots.map((p, i) => (
              <circle
                key={`${p.x.toFixed(1)}-${p.y.toFixed(1)}-${i}`}
                cx={p.x}
                cy={p.y}
                r={3.5}
                className="weight-chart-dot"
              />
            ))}
            {geo.yLabels.map((l) => (
              <text
                key={`y-${l.y}`}
                x={chartLeft - 8}
                y={l.y + 4}
                textAnchor="end"
                className="weight-chart-tick"
              >
                {l.text}
              </text>
            ))}
            {geo.xLabels.map((l) => (
              <text
                key={`x-${l.x}`}
                x={l.x}
                y={chartBottom + 18}
                textAnchor="middle"
                className="weight-chart-tick"
              >
                {l.text}
              </text>
            ))}
          </>
        ) : null}
      </svg>
    </div>
  );
}
