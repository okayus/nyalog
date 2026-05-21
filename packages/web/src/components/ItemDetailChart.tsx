import { CHART_DIMS, type ChartGeometry } from "./blood-test-display";

// per-item の詳細チャート。popover の中で表示される前提。
// 軸ラベル付き、reference band 矩形 (refLow〜refHigh) を薄い緑帯で描画。
// 単点は WeightChart と同じ "single" kind で中央に dot + ラベル。

type Props = {
  geom: ChartGeometry;
  label: string;
  unit: string | null;
};

export function ItemDetailChart({ geom, label, unit }: Props) {
  const { width, height, padding } = CHART_DIMS;
  const chartLeft = padding.left;
  const chartRight = width - padding.right;
  const chartTop = padding.top;
  const chartBottom = height - padding.bottom;
  const chartWidth = chartRight - chartLeft;
  const ariaLabel = unit ? `${label} (${unit}) の推移` : `${label} の推移`;

  return (
    <div className="item-detail-chart">
      <h3 className="item-detail-chart-title">
        {label}
        {unit && <span className="item-detail-chart-unit"> ({unit})</span>}
      </h3>
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* 軸 */}
        <line
          x1={chartLeft}
          y1={chartTop}
          x2={chartLeft}
          y2={chartBottom}
          className="item-detail-axis"
        />
        <line
          x1={chartLeft}
          y1={chartBottom}
          x2={chartRight}
          y2={chartBottom}
          className="item-detail-axis"
        />

        {geom.kind === "empty" ? (
          <text
            x={width / 2}
            y={height / 2}
            textAnchor="middle"
            className="item-detail-chart-empty"
          >
            データなし
          </text>
        ) : (
          <>
            {/* reference band は軸より前 (背後) に描く */}
            {geom.refBand && (
              <rect
                x={chartLeft}
                y={geom.refBand.y0}
                width={chartWidth}
                height={geom.refBand.y1 - geom.refBand.y0}
                className="item-detail-ref-band"
              />
            )}

            {geom.kind === "single" && (
              <>
                <circle
                  cx={geom.point.x}
                  cy={geom.point.y}
                  r={5}
                  className="item-detail-dot"
                  data-flag={geom.point.flag}
                />
                <text
                  x={geom.point.x}
                  y={geom.point.y - 12}
                  textAnchor="middle"
                  className="item-detail-value"
                >
                  {geom.label}
                </text>
                <text
                  x={geom.point.x}
                  y={chartBottom + 18}
                  textAnchor="middle"
                  className="item-detail-tick"
                >
                  {geom.xAxisLabel}
                </text>
              </>
            )}

            {geom.kind === "line" && (
              <>
                <polyline points={geom.polyline} fill="none" className="item-detail-line" />
                {geom.dots.map((p, i) => (
                  <circle
                    key={`${p.x.toFixed(1)}-${p.y.toFixed(1)}-${i}`}
                    cx={p.x}
                    cy={p.y}
                    r={3.5}
                    className="item-detail-dot"
                    data-flag={p.flag}
                  />
                ))}
                {geom.yLabels.map((l) => (
                  <text
                    key={`y-${l.y}`}
                    x={chartLeft - 8}
                    y={l.y + 4}
                    textAnchor="end"
                    className="item-detail-tick"
                  >
                    {l.text}
                  </text>
                ))}
                {geom.xLabels.map((l) => (
                  <text
                    key={`x-${l.x}`}
                    x={l.x}
                    y={chartBottom + 18}
                    textAnchor="middle"
                    className="item-detail-tick"
                  >
                    {l.text}
                  </text>
                ))}
              </>
            )}
          </>
        )}
      </svg>
    </div>
  );
}
