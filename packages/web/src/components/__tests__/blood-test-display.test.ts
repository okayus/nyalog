import { describe, expect, it } from "vitest";
import type {
  AnalysisId,
  BloodTestValue,
  ValueFlag,
  ValueId,
} from "../../../worker/domain/blood-test-analysis";
import {
  buildItemChartGeometry,
  buildItemSeries,
  buildSparklineGeometry,
  computeDelta,
  groupItemsByCategory,
  type ItemSeriesPoint,
} from "../blood-test-display";

const ANALYSIS_ID = "00000000-0000-0000-0000-000000000001" as AnalysisId;

function mkValue(overrides: Partial<BloodTestValue> & { itemCode: string }): BloodTestValue {
  return {
    id: "00000000-0000-0000-0000-000000000000" as ValueId,
    analysisId: ANALYSIS_ID,
    itemLabel: overrides.itemCode,
    unit: null,
    valueText: "0",
    valueNumeric: null,
    refLow: null,
    refHigh: null,
    refText: null,
    flag: "unknown" as ValueFlag,
    notes: null,
    rowIndex: 0,
    reviewed: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function mkPoint(overrides: Partial<ItemSeriesPoint> & { recordedAt: string }): ItemSeriesPoint {
  return {
    valueNumeric: null,
    valueText: "0",
    unit: null,
    flag: "unknown",
    refLow: null,
    refHigh: null,
    ...overrides,
  };
}

describe("buildItemSeries", () => {
  it("returns empty object for empty input", () => {
    expect(buildItemSeries([])).toEqual({});
  });

  it("groups values by item_code across analyses, sorted ascending by recordedAt", () => {
    const series = buildItemSeries([
      {
        recordedAt: "2026-03-01T00:00:00Z",
        values: [mkValue({ itemCode: "Hb", valueNumeric: 15.2 })],
      },
      {
        recordedAt: "2026-01-01T00:00:00Z",
        values: [
          mkValue({ itemCode: "Hb", valueNumeric: 14.0 }),
          mkValue({ itemCode: "RBC", valueNumeric: 4.5 }),
        ],
      },
      {
        recordedAt: "2026-02-01T00:00:00Z",
        values: [mkValue({ itemCode: "Hb", valueNumeric: 14.8 })],
      },
    ]);

    expect(Object.keys(series).sort()).toEqual(["Hb", "RBC"]);
    expect(series.Hb.map((p) => p.valueNumeric)).toEqual([14.0, 14.8, 15.2]);
    expect(series.RBC.map((p) => p.valueNumeric)).toEqual([4.5]);
  });

  it("only includes item in series when it appears in that analysis", () => {
    const series = buildItemSeries([
      {
        recordedAt: "2026-01-01T00:00:00Z",
        values: [mkValue({ itemCode: "Hb", valueNumeric: 14.0 })],
      },
      {
        recordedAt: "2026-02-01T00:00:00Z",
        values: [mkValue({ itemCode: "RBC", valueNumeric: 4.5 })],
      },
    ]);
    expect(series.Hb).toHaveLength(1);
    expect(series.RBC).toHaveLength(1);
  });
});

describe("computeDelta", () => {
  it("returns no_previous when prev is null", () => {
    const curr = mkPoint({ recordedAt: "2026-02-01", valueNumeric: 14.0 });
    expect(computeDelta(null, curr, 12, 15.5)).toEqual({ kind: "no_previous" });
  });

  it("returns non_numeric when either value is null", () => {
    const prev = mkPoint({ recordedAt: "2026-01-01", valueNumeric: null });
    const curr = mkPoint({ recordedAt: "2026-02-01", valueNumeric: 14.0 });
    expect(computeDelta(prev, curr, 12, 15.5).kind).toBe("non_numeric");
  });

  it("returns no_change for equal values", () => {
    const prev = mkPoint({ recordedAt: "2026-01-01", valueNumeric: 14.0 });
    const curr = mkPoint({ recordedAt: "2026-02-01", valueNumeric: 14.0 });
    expect(computeDelta(prev, curr, 12, 15.5).kind).toBe("no_change");
  });

  it("treats both-inside-ref movement as neutral (no judgement within normal)", () => {
    const prev = mkPoint({ recordedAt: "2026-01-01", valueNumeric: 14.0 });
    const curr = mkPoint({ recordedAt: "2026-02-01", valueNumeric: 14.5 });
    expect(computeDelta(prev, curr, 12, 15.5)).toEqual({
      kind: "change",
      delta: 0.5,
      direction: "up",
      towardNormal: "neutral",
    });
  });

  it("crossing refHigh upward is away from normal", () => {
    const prev = mkPoint({ recordedAt: "2026-01-01", valueNumeric: 14.0 });
    const curr = mkPoint({ recordedAt: "2026-02-01", valueNumeric: 15.6 });
    const d = computeDelta(prev, curr, 12, 15.5);
    expect(d.kind === "change" && d.towardNormal).toBe("away");
  });

  it("returning from above refHigh into range is toward normal", () => {
    const prev = mkPoint({ recordedAt: "2026-01-01", valueNumeric: 16.5 });
    const curr = mkPoint({ recordedAt: "2026-02-01", valueNumeric: 15.0 });
    const d = computeDelta(prev, curr, 12, 15.5);
    expect(d.kind === "change" && d.towardNormal).toBe("toward");
  });

  it("further outside ref is away from normal", () => {
    const prev = mkPoint({ recordedAt: "2026-01-01", valueNumeric: 16.0 });
    const curr = mkPoint({ recordedAt: "2026-02-01", valueNumeric: 17.5 });
    const d = computeDelta(prev, curr, 12, 15.5);
    expect(d.kind === "change" && d.towardNormal).toBe("away");
  });

  it("closer to refHigh but still outside is toward normal", () => {
    const prev = mkPoint({ recordedAt: "2026-01-01", valueNumeric: 17.5 });
    const curr = mkPoint({ recordedAt: "2026-02-01", valueNumeric: 16.5 });
    const d = computeDelta(prev, curr, 12, 15.5);
    expect(d.kind === "change" && d.towardNormal).toBe("toward");
  });

  it("returns neutral when both refs are null (no judgement possible)", () => {
    const prev = mkPoint({ recordedAt: "2026-01-01", valueNumeric: 100 });
    const curr = mkPoint({ recordedAt: "2026-02-01", valueNumeric: 150 });
    const d = computeDelta(prev, curr, null, null);
    expect(d.kind === "change" && d.towardNormal).toBe("neutral");
  });

  it("respects refLow-only direction (going below is away)", () => {
    const prev = mkPoint({ recordedAt: "2026-01-01", valueNumeric: 4.5 });
    const curr = mkPoint({ recordedAt: "2026-02-01", valueNumeric: 3.5 });
    const d = computeDelta(prev, curr, 4.0, null);
    expect(d.kind === "change" && d.towardNormal).toBe("away");
  });

  it("respects refHigh-only direction (returning below high is toward)", () => {
    const prev = mkPoint({ recordedAt: "2026-01-01", valueNumeric: 220 });
    const curr = mkPoint({ recordedAt: "2026-02-01", valueNumeric: 180 });
    const d = computeDelta(prev, curr, null, 200);
    expect(d.kind === "change" && d.towardNormal).toBe("toward");
  });
});

describe("buildItemChartGeometry", () => {
  it("returns empty for no points", () => {
    expect(buildItemChartGeometry([], 12, 15.5)).toEqual({ kind: "empty" });
  });

  it("returns empty when all points lack numeric value", () => {
    const points = [mkPoint({ recordedAt: "2026-01-01", valueNumeric: null })];
    expect(buildItemChartGeometry(points, null, null).kind).toBe("empty");
  });

  it("returns single when only one numeric point exists", () => {
    const points = [
      mkPoint({ recordedAt: "2026-01-01", valueNumeric: 14.0, unit: "g/dL", flag: "normal" }),
    ];
    const g = buildItemChartGeometry(points, 12, 15.5);
    expect(g.kind).toBe("single");
    if (g.kind !== "single") throw new Error();
    expect(g.label).toContain("g/dL");
    expect(g.point.flag).toBe("normal");
    expect(g.refBand).not.toBeNull();
  });

  it("refBand is null when both refs are null", () => {
    const points = [
      mkPoint({ recordedAt: "2026-01-01", valueNumeric: 14.0 }),
      mkPoint({ recordedAt: "2026-02-01", valueNumeric: 14.5 }),
    ];
    const g = buildItemChartGeometry(points, null, null);
    expect(g.kind).toBe("line");
    if (g.kind !== "line") throw new Error();
    expect(g.refBand).toBeNull();
  });

  it("refBand is built even when only one of refLow/refHigh is set", () => {
    const points = [
      mkPoint({ recordedAt: "2026-01-01", valueNumeric: 14.0 }),
      mkPoint({ recordedAt: "2026-02-01", valueNumeric: 14.5 }),
    ];
    const g = buildItemChartGeometry(points, null, 15.5);
    expect(g.kind === "line" && g.refBand !== null).toBe(true);
  });

  it("returns line with dots and polyline for multiple points, sorted by date", () => {
    const points = [
      mkPoint({ recordedAt: "2026-03-01", valueNumeric: 15.0, flag: "normal" }),
      mkPoint({ recordedAt: "2026-01-01", valueNumeric: 13.0, flag: "low" }),
      mkPoint({ recordedAt: "2026-02-01", valueNumeric: 14.0, flag: "normal" }),
    ];
    const g = buildItemChartGeometry(points, 12, 15.5);
    expect(g.kind).toBe("line");
    if (g.kind !== "line") throw new Error();
    expect(g.dots).toHaveLength(3);
    expect(g.dots[0].flag).toBe("low");
    expect(g.dots[2].flag).toBe("normal");
    expect(g.polyline.split(" ")).toHaveLength(3);
  });
});

describe("buildSparklineGeometry", () => {
  it("returns empty for no numeric points", () => {
    expect(buildSparklineGeometry([])).toEqual({ kind: "empty" });
    expect(
      buildSparklineGeometry([mkPoint({ recordedAt: "2026-01-01", valueNumeric: null })]).kind,
    ).toBe("empty");
  });

  it("returns dot for a single point (no polyline)", () => {
    const g = buildSparklineGeometry([
      mkPoint({ recordedAt: "2026-01-01", valueNumeric: 14.0, flag: "high" }),
    ]);
    expect(g.kind).toBe("dot");
    if (g.kind === "dot") expect(g.flag).toBe("high");
  });

  it("returns line for multiple points with last point flag from latest", () => {
    const g = buildSparklineGeometry([
      mkPoint({ recordedAt: "2026-01-01", valueNumeric: 13.0, flag: "low" }),
      mkPoint({ recordedAt: "2026-02-01", valueNumeric: 14.0, flag: "normal" }),
      mkPoint({ recordedAt: "2026-03-01", valueNumeric: 15.5, flag: "high" }),
    ]);
    expect(g.kind).toBe("line");
    if (g.kind === "line") expect(g.lastPoint.flag).toBe("high");
  });

  it("handles all-equal values without divide-by-zero (padded range)", () => {
    const g = buildSparklineGeometry([
      mkPoint({ recordedAt: "2026-01-01", valueNumeric: 5.0, flag: "normal" }),
      mkPoint({ recordedAt: "2026-02-01", valueNumeric: 5.0, flag: "normal" }),
      mkPoint({ recordedAt: "2026-03-01", valueNumeric: 5.0, flag: "normal" }),
    ]);
    expect(g.kind).toBe("line");
    if (g.kind !== "line") throw new Error();
    // all dots should land at the same y (no NaN)
    const ys = g.polyline.split(" ").map((p) => Number(p.split(",")[1]));
    expect(ys.every((y) => Number.isFinite(y))).toBe(true);
  });
});

describe("groupItemsByCategory", () => {
  it("returns empty array for empty input", () => {
    expect(groupItemsByCategory([])).toEqual([]);
  });

  it("groups known item codes into canonical category order, skipping empty categories", () => {
    const items = [
      mkValue({ itemCode: "Na", rowIndex: 0 }), // 電解質
      mkValue({ itemCode: "Hb", rowIndex: 1 }), // CBC
      mkValue({ itemCode: "T4", rowIndex: 2 }), // ホルモン
    ];
    const groups = groupItemsByCategory(items);
    expect(groups.map((g) => g.category)).toEqual(["CBC", "電解質", "ホルモン"]);
  });

  it("falls back unknown codes into その他", () => {
    const items = [
      mkValue({ itemCode: "MysteryCode", rowIndex: 0 }),
      mkValue({ itemCode: "Hb", rowIndex: 1 }),
    ];
    const groups = groupItemsByCategory(items);
    expect(groups.map((g) => g.category)).toEqual(["CBC", "その他"]);
    expect(groups[1].items[0].itemCode).toBe("MysteryCode");
  });

  it("sorts items within a category by rowIndex (preserves AI extraction order)", () => {
    const items = [
      mkValue({ itemCode: "Hb", rowIndex: 5 }),
      mkValue({ itemCode: "RBC", rowIndex: 2 }),
      mkValue({ itemCode: "Plt", rowIndex: 9 }),
    ];
    const groups = groupItemsByCategory(items);
    expect(groups[0].items.map((i) => i.itemCode)).toEqual(["RBC", "Hb", "Plt"]);
  });
});
