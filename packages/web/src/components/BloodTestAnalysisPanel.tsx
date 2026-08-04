import type {
  BloodTestAnalysis,
  BloodTestValue,
  ValueFlag,
} from "../../worker/domain/blood-test-analysis";
import {
  buildItemChartGeometry,
  buildSparklineGeometry,
  computeDelta,
  findPreviousPoint,
  groupItemsByCategory,
  type Delta,
  type ItemSeries,
  type ItemSeriesPoint,
} from "./blood-test-display";
import { ErrorText } from "./ErrorText";
import { ItemDetailChart } from "./ItemDetailChart";
import { Sparkline } from "./Sparkline";

// blood_test attachment 1 枚分の解析結果パネル。MedicalRecordsView の attachment
// ループから差し込まれる。Sparkline と per-item 詳細チャート popover は PR C で。
//
// `state` は API レスポンスの状態を Discriminated Union で表現する。404 と 200 の
// 両方が「正常な経路」なので、エラー扱いではなく `missing` という kind として持つ。

export type PanelState =
  | { kind: "missing" }
  | { kind: "pending" }
  | { kind: "running" }
  | { kind: "failed"; errorMessage: string }
  | { kind: "succeeded"; analysis: BloodTestAnalysis; values: BloodTestValue[] };

type Props = {
  state: PanelState;
  series: ItemSeries;
  recordedAt: string;
  themeColor: string;
  analyzing: boolean;
  onAnalyze: () => void;
};

const OPEN_BY_DEFAULT = new Set(["CBC", "生化学"]);

const FLAG_BADGE: Record<ValueFlag, { label: string; ariaLabel: string } | null> = {
  high: { label: "⚠️H", ariaLabel: "基準値より高い" },
  low: { label: "⚠️L", ariaLabel: "基準値より低い" },
  abnormal: { label: "🔶", ariaLabel: "異常値" },
  normal: null,
  unknown: null,
};

function formatValue(item: BloodTestValue): string {
  if (item.valueNumeric === null) return item.valueText;
  // 大きな数字はカンマ区切り (赤血球数 4_800_000 → 4,800,000)。
  // 小数や 4 桁以下は AI 原文をそのまま信用する。
  if (Math.abs(item.valueNumeric) >= 10_000) {
    return item.valueNumeric.toLocaleString("ja-JP");
  }
  return item.valueText;
}

function formatRef(item: BloodTestValue): string | null {
  if (item.refText) return item.refText;
  if (item.refLow !== null && item.refHigh !== null) return `${item.refLow}〜${item.refHigh}`;
  if (item.refLow !== null) return `≥ ${item.refLow}`;
  if (item.refHigh !== null) return `≤ ${item.refHigh}`;
  return null;
}

function formatDeltaNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(1);
  return v.toFixed(2);
}

function DeltaCell({ delta }: { delta: Delta }) {
  if (delta.kind === "no_previous" || delta.kind === "non_numeric") {
    return (
      <span className="blood-test-delta" data-toward="none">
        —
      </span>
    );
  }
  if (delta.kind === "no_change") {
    return (
      <span className="blood-test-delta" data-toward="neutral">
        ±0
      </span>
    );
  }
  const sign = delta.delta > 0 ? "+" : "";
  const arrow = delta.direction === "up" ? "↑" : "↓";
  return (
    <span className="blood-test-delta" data-toward={delta.towardNormal}>
      {sign}
      {formatDeltaNumber(delta.delta)} {arrow}
    </span>
  );
}

export function BloodTestAnalysisPanel({
  state,
  series,
  recordedAt,
  themeColor,
  analyzing,
  onAnalyze,
}: Props) {
  if (state.kind === "missing") {
    return (
      <div className="blood-test-panel" data-cat-theme={themeColor}>
        <p className="blood-test-status">📊 まだ解析されていません</p>
        <button type="button" onClick={onAnalyze} disabled={analyzing}>
          {analyzing ? "🤖 解析中…" : "🤖 AI で解析"}
        </button>
      </div>
    );
  }

  if (state.kind === "pending" || state.kind === "running") {
    return (
      <div className="blood-test-panel" data-cat-theme={themeColor}>
        <p className="blood-test-status">🤖 AI が解析中…</p>
      </div>
    );
  }

  if (state.kind === "failed") {
    return (
      <div className="blood-test-panel" data-cat-theme={themeColor}>
        <ErrorText>{`解析失敗: ${state.errorMessage}`}</ErrorText>
        <button type="button" onClick={onAnalyze} disabled={analyzing}>
          {analyzing ? "🤖 再解析中…" : "🔁 再解析"}
        </button>
      </div>
    );
  }

  const groups = groupItemsByCategory(state.values);

  return (
    <div className="blood-test-panel" data-cat-theme={themeColor}>
      <p className="blood-test-meta">🩸 解析モデル: {state.analysis.modelName}</p>
      {groups.length === 0 && <p className="blood-test-status">抽出された項目がありません</p>}
      {groups.map((g) => (
        <details
          key={g.category}
          className="blood-test-category"
          open={OPEN_BY_DEFAULT.has(g.category)}
        >
          <summary>
            <span className="category-name">{g.category}</span>
            <span className="category-count">{g.items.length} 項目</span>
          </summary>
          <table className="blood-test-table">
            <thead>
              <tr>
                <th scope="col">項目</th>
                <th scope="col">値</th>
                <th scope="col">前回比</th>
                <th scope="col">推移</th>
              </tr>
            </thead>
            <tbody>
              {g.items.map((item) => {
                const itemSeries = series[item.itemCode] ?? [];
                const prev = findPreviousPoint(itemSeries, recordedAt);
                const curr: ItemSeriesPoint = {
                  recordedAt,
                  valueNumeric: item.valueNumeric,
                  valueText: item.valueText,
                  unit: item.unit,
                  flag: item.flag,
                  refLow: item.refLow,
                  refHigh: item.refHigh,
                };
                const delta = computeDelta(prev, curr, item.refLow, item.refHigh);
                const badge = FLAG_BADGE[item.flag];
                const refDisplay = formatRef(item);
                const sparklineGeom = buildSparklineGeometry(itemSeries);
                const chartGeom = buildItemChartGeometry(itemSeries, item.refLow, item.refHigh);
                const popoverId = `bt-popover-${item.id}`;
                return (
                  <tr key={item.id} className="blood-test-row" data-flag={item.flag}>
                    <td>
                      <span className="item-name">{item.itemLabel}</span>
                      {badge && (
                        <span className="flag-badge" aria-label={badge.ariaLabel}>
                          {" "}
                          {badge.label}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="item-value">
                        {formatValue(item)}
                        {item.unit ? ` ${item.unit}` : ""}
                      </span>
                      {refDisplay && <small className="item-ref"> ({refDisplay})</small>}
                    </td>
                    <td>
                      <DeltaCell delta={delta} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="sparkline-trigger"
                        popoverTarget={popoverId}
                        aria-label={`${item.itemLabel} の推移チャートを開く`}
                      >
                        <Sparkline geom={sparklineGeom} />
                      </button>
                      <div id={popoverId} popover="auto" className="item-detail-popover">
                        <ItemDetailChart geom={chartGeom} label={item.itemLabel} unit={item.unit} />
                        <button
                          type="button"
                          popoverTarget={popoverId}
                          popoverTargetAction="hide"
                          className="item-detail-close"
                          aria-label="閉じる"
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      ))}
    </div>
  );
}
