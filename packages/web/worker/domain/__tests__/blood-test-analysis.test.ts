import { describe, expect, test } from "vitest";
import { normalizeFlag, parseGemmaJsonResponse } from "../blood-test-analysis";
import { lookupItemCode } from "../blood-test-items";

describe("parseGemmaJsonResponse", () => {
  test("正常 JSON をパースして ExtractedItem[] を返す", () => {
    const raw = JSON.stringify({
      items: [
        {
          itemCode: "BUN",
          itemLabel: "血中尿素窒素",
          unit: "mg/dL",
          valueText: "47.1",
          valueNumeric: 47.1,
          refLow: 17.6,
          refHigh: 32.8,
          refText: "17.6 ~ 32.8",
          flag: "high",
          notes: "腎機能障害",
        },
      ],
    });
    const result = parseGemmaJsonResponse(raw);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toMatchObject({
        itemCode: "BUN",
        itemLabel: "血中尿素窒素",
        unit: "mg/dL",
        valueText: "47.1",
        valueNumeric: 47.1,
        refLow: 17.6,
        refHigh: 32.8,
        flag: "high",
        notes: "腎機能障害",
        rowIndex: 0,
      });
    }
  });

  test("マークダウン code fence (```json ... ```) を剥がしてパースする", () => {
    const raw =
      '```json\n{"items":[{"itemLabel":"血中尿素窒素","valueText":"47.1","flag":"high"}]}\n```';
    const result = parseGemmaJsonResponse(raw);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value[0].itemLabel).toBe("血中尿素窒素");
    }
  });

  test("不正な JSON は parse_error", () => {
    const result = parseGemmaJsonResponse("not json at all");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("parse_error");
    }
  });

  test("shape 不一致は validation_error", () => {
    const result = parseGemmaJsonResponse(JSON.stringify({ wrong: "shape" }));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe("validation_error");
    }
  });

  test("空 items は許容して空配列を返す", () => {
    const result = parseGemmaJsonResponse(JSON.stringify({ items: [] }));
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([]);
    }
  });

  test("itemCode が無いとき辞書から自動補完する", () => {
    const result = parseGemmaJsonResponse(
      JSON.stringify({
        items: [{ itemLabel: "血中尿素窒素", valueText: "47.1" }],
      }),
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value[0].itemCode).toBe("BUN");
    }
  });

  test("flag が無いとき normalizeFlag フォールバックが効く", () => {
    const result = parseGemmaJsonResponse(
      JSON.stringify({
        items: [
          {
            itemLabel: "血中尿素窒素",
            valueText: "47.1",
            valueNumeric: 47.1,
            refLow: 17.6,
            refHigh: 32.8,
          },
        ],
      }),
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value[0].flag).toBe("high");
    }
  });

  test("rowIndex は配列順で 0 始まり", () => {
    const result = parseGemmaJsonResponse(
      JSON.stringify({
        items: [
          { itemLabel: "A", valueText: "1" },
          { itemLabel: "B", valueText: "2" },
          { itemLabel: "C", valueText: "3" },
        ],
      }),
    );
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.map((v) => v.rowIndex)).toEqual([0, 1, 2]);
    }
  });
});

describe("normalizeFlag", () => {
  test("数値が refHigh 超なら high", () => {
    expect(normalizeFlag(47.1, 17.6, 32.8, null)).toBe("high");
  });

  test("数値が refLow 未満なら low", () => {
    expect(normalizeFlag(146, 147, 156, null)).toBe("low");
  });

  test("数値が範囲内なら normal", () => {
    expect(normalizeFlag(4.5, 3.4, 5.6, null)).toBe("normal");
  });

  test("値も基準値もないと unknown", () => {
    expect(normalizeFlag(null, null, null, null)).toBe("unknown");
  });

  test("hint に '低' があれば数値より優先で low", () => {
    expect(normalizeFlag(50, 17.6, 32.8, "低値の傾向")).toBe("low");
  });

  test("hint に '高' があれば数値より優先で high", () => {
    expect(normalizeFlag(20, 17.6, 32.8, "高値の傾向")).toBe("high");
  });

  test("hint に '異常' のみは abnormal", () => {
    expect(normalizeFlag(null, null, null, "異常所見")).toBe("abnormal");
  });

  test("refLow のみで未満なら low", () => {
    expect(normalizeFlag(5, 10, null, null)).toBe("low");
  });

  test("refHigh のみで超なら high", () => {
    expect(normalizeFlag(15, null, 10, null)).toBe("high");
  });

  test("値が null かつ ref のみ与えられても unknown (比較不能)", () => {
    expect(normalizeFlag(null, 10, 20, null)).toBe("unknown");
  });
});

describe("lookupItemCode", () => {
  test("辞書一致でコードを返す", () => {
    expect(lookupItemCode("血中尿素窒素")).toBe("BUN");
    expect(lookupItemCode("総白血球数")).toBe("WBC");
  });

  test("表記ゆれエントリも引ける", () => {
    expect(lookupItemCode("白血球数")).toBe("WBC");
    expect(lookupItemCode("血液の濃度")).toBe("HCT");
  });

  test("辞書未収録はラベルをそのまま返す", () => {
    expect(lookupItemCode("謎の項目")).toBe("謎の項目");
  });

  test("前後空白を trim する", () => {
    expect(lookupItemCode("  ヘモグロビン濃度 ")).toBe("Hb");
  });
});
