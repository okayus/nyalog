import { SPARKLINE_DIMS, type SparklineGeometry } from "./blood-test-display";

// テーブル inline 用の極小チャート。60×20px、軸ラベルなし。
// 色は data-flag 属性に乗せて CSS 側で OKLCH トークンを当てる。
// クリッカブルにする責務は呼び出し側 (<button> でラップする) に任せる。
export function Sparkline({ geom }: { geom: SparklineGeometry }) {
  if (geom.kind === "empty") {
    return (
      <svg
        className="sparkline"
        viewBox={`0 0 ${SPARKLINE_DIMS.width} ${SPARKLINE_DIMS.height}`}
        aria-hidden="true"
      >
        <text
          x={SPARKLINE_DIMS.width / 2}
          y={SPARKLINE_DIMS.height / 2 + 3}
          textAnchor="middle"
          className="sparkline-empty"
        >
          —
        </text>
      </svg>
    );
  }

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${SPARKLINE_DIMS.width} ${SPARKLINE_DIMS.height}`}
      aria-hidden="true"
    >
      {geom.kind === "dot" && (
        <circle cx={geom.x} cy={geom.y} r={2.2} className="sparkline-dot" data-flag={geom.flag} />
      )}
      {geom.kind === "line" && (
        <>
          <polyline points={geom.polyline} fill="none" className="sparkline-line" />
          <circle
            cx={geom.lastPoint.x}
            cy={geom.lastPoint.y}
            r={2.2}
            className="sparkline-dot"
            data-flag={geom.lastPoint.flag}
          />
        </>
      )}
    </svg>
  );
}
