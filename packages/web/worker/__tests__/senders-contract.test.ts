import { describe, expect, test } from "vitest";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { CreateCompletionSchema, DueItemSchema, TaskCompletionRowSchema } from "../domain/cat-task";
import { CreateToiletRecordSchema, ToiletRecordRowSchema } from "../domain/toilet-record";

// 呼び出し側 (ochanoma) が vendoring する JSON Schema を、route が使う zod スキーマから生成して
// docs/senders/ に固定する (ADR-009 §5)。zod を変えるとここが落ちる →
// `vitest run -u worker/__tests__/senders-contract.test.ts` で再生成 → senders.md の変更履歴に
// 1 行 → 呼び出し側に知らせる。手で書き換えない。
//
// 落ちるもの: .refine (未来の拒否、期間上限) と .transform (UTC Z への正規化)。
// これらは senders.md の「schema に書けない規則」に書く。

const RAW_BASE = "https://raw.githubusercontent.com/okayus/nyalog/main/docs/senders/";
const SNAPSHOT_DIR = "../../../../docs/senders/";

type Doc = {
  title: string;
  description: string;
  // property 名 → 説明。schema に現れる全 property を網羅していないとテストが落ちる。
  fields: Record<string, string>;
  // YYYY-MM-DD の property。regex しか schema に残らないので format: date を添える。
  dateFields?: readonly string[];
};

type JsonObject = Record<string, unknown>;

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// properties を持つ node を全部回る (トップレベル、anyOf の各枝、items)。
function eachObjectNode(node: unknown, visit: (properties: JsonObject) => void): void {
  if (!isObject(node)) return;
  if (isObject(node.properties)) visit(node.properties);
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const branches = node[key];
    if (Array.isArray(branches)) for (const b of branches) eachObjectNode(b, visit);
  }
  eachObjectNode(node.items, visit);
}

function generate(schema: z.ZodTypeAny, file: string, doc: Doc): string {
  const { $schema, ...rest } = zodToJsonSchema(schema, { $refStrategy: "none" }) as JsonObject;
  const missing: string[] = [];
  eachObjectNode(rest, (properties) => {
    for (const [name, prop] of Object.entries(properties)) {
      if (!isObject(prop)) continue;
      const description = doc.fields[name];
      if (description === undefined) {
        missing.push(name);
        continue;
      }
      prop.description = description;
      if (doc.dateFields?.includes(name)) prop.format = "date";
    }
  });
  expect(missing, `${file}: 説明の無い property`).toEqual([]);
  const out = {
    $schema,
    $id: RAW_BASE + file,
    title: doc.title,
    description: doc.description,
    ...rest,
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

const TIMESTAMP_DOC =
  "RFC 3339。オフセット付き可。未来は 60 秒まで。保存と応答は UTC の Z 表記 (ミリ秒付き)";

const CONTRACTS: ReadonlyArray<{ file: string; schema: z.ZodTypeAny; doc: Doc }> = [
  {
    file: "toilet-record-create.schema.json",
    schema: CreateToiletRecordSchema,
    doc: {
      title: "POST /api/cats/{catId}/toilet-records の body",
      description:
        "トイレ記録を 1 件作る。type で形が変わる (urination は condition を持たない)。Idempotency-Key ヘッダで再送を 1 件にできる",
      fields: {
        type: "urination (排尿) か defecation (排便)。both は送れない。2 回に分ける",
        timestamp: TIMESTAMP_DOC,
        condition: "defecation のときだけ必須。便の状態",
      },
    },
  },
  {
    file: "toilet-record.schema.json",
    schema: ToiletRecordRowSchema,
    doc: {
      title: "toilet-records の応答 (201 / 200)",
      description: "作成した記録。取り消しは id で DELETE する",
      fields: {
        id: "記録の UUID。DELETE /api/cats/{catId}/toilet-records/{id} に使う",
        catId: "猫の UUID",
        type: "urination か defecation",
        timestamp: "UTC Z 表記に正規化済み",
        condition: "defecation のときだけ",
        createdAt: "作成時刻 (UTC Z)",
        updatedAt: "更新時刻 (UTC Z)",
      },
    },
  },
  {
    file: "task-completion-create.schema.json",
    schema: CreateCompletionSchema,
    doc: {
      title: "POST /api/tasks/{taskId}/completions の body",
      description:
        "タスクをその日・その猫について完了にする。同じ (task, cat, dueDate) は既存の完了を 200 で返す (冪等)",
      fields: {
        catId: "猫の UUID。タスクに紐づいていなければ 404",
        dueDate: "予定日 (YYYY-MM-DD)。GET /api/tasks/due の dueDate をそのまま",
        completedAt: TIMESTAMP_DOC,
      },
      dateFields: ["dueDate"],
    },
  },
  {
    file: "task-completion.schema.json",
    schema: TaskCompletionRowSchema,
    doc: {
      title: "completions の応答 (201 / 200)",
      description: "完了の記録。取り消しは id で DELETE する",
      fields: {
        id: "完了の UUID。DELETE /api/tasks/{taskId}/completions/{id} に使う",
        taskId: "タスクの UUID",
        catId: "猫の UUID",
        dueDate: "予定日 (YYYY-MM-DD)",
        completedAt: "UTC Z 表記に正規化済み",
        completedBy: "完了した利用者の UUID。PAT なら発行者",
        createdAt: "作成時刻 (UTC Z)",
      },
      dateFields: ["dueDate"],
    },
  },
  {
    file: "tasks-due-response.schema.json",
    schema: DueItemSchema.array(),
    doc: {
      title: "GET /api/tasks/due?from&to の応答",
      description:
        "期間内の予定日を (task × cat × dueDate) ごとに 1 要素で。dueDate、taskId、catId の順",
      fields: {
        taskId: "タスクの UUID",
        title: "タスク名",
        catId: "猫の UUID",
        catName: "猫の表示名 (nyalog 側)",
        dueDate: "予定日 (YYYY-MM-DD)",
        completed: "その日・その猫について完了済みか",
      },
      dateFields: ["dueDate"],
    },
  },
];

describe("senders contract (docs/senders/*.schema.json は zod から生成)", () => {
  for (const { file, schema, doc } of CONTRACTS) {
    test(`${file} は route の zod スキーマと一致する`, async () => {
      await expect(generate(schema, file, doc)).toMatchFileSnapshot(SNAPSHOT_DIR + file);
    });
  }

  test("type で形が変わる body は anyOf の 2 枝で、時刻は date-time", () => {
    const json = JSON.parse(
      generate(CreateToiletRecordSchema, "x", CONTRACTS[0].doc),
    ) as JsonObject;
    expect(json.$schema).toBe("http://json-schema.org/draft-07/schema#");
    const branches = json.anyOf as JsonObject[];
    expect(branches).toHaveLength(2);
    const timestamp = (branches[0].properties as JsonObject).timestamp as JsonObject;
    expect(timestamp.format).toBe("date-time");
    expect(branches[0].additionalProperties).toBe(false);
  });
});
