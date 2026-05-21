import { Fragment, useEffect, useMemo, useState } from "react";
import type { MedicalRecord, MedicalRecordAttachment } from "../../worker/domain/medical-record";
import {
  createMedicalRecord,
  deleteMedicalAttachment,
  deleteMedicalRecord,
  getBloodTestAnalysis,
  listMedicalAttachments,
  listMedicalRecords,
  medicalAttachmentUrl,
  triggerBloodTestAnalyze,
  updateMedicalRecord,
  uploadMedicalAttachment,
} from "../api";
import { withViewTransition } from "../view-transition";
import { BloodTestAnalysisPanel, type PanelState } from "./BloodTestAnalysisPanel";
import { type AnalysisForDisplay, buildItemSeries } from "./blood-test-display";
import { ConfirmButton } from "./ConfirmButton";

type Props = {
  catId: string;
  catName: string;
  themeColor: string;
  onBack: () => void;
};

const TYPE_OPTIONS: { value: MedicalRecord["type"]; label: string; emoji: string }[] = [
  { value: "blood_test", label: "血液検査", emoji: "🩸" },
  { value: "other", label: "その他", emoji: "📋" },
];

// `<img>` で確実に表示できる MIME は限定する。HEIC/HEIF は Chrome/Firefox での
// 表示が不確実なのでダウンロードリンクに倒す。PDF も同様。
const INLINE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Workers AI Gemma が解析できる image MIME (PDF 不可、HEIC 不可)。POST /analyze
// 側の ANALYZABLE_CONTENT_TYPES と揃える。
const ANALYZABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const ACCEPT_MIMES = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";

function typeLabel(t: MedicalRecord["type"]): string {
  return TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

function typeEmoji(t: MedicalRecord["type"]): string {
  return TYPE_OPTIONS.find((o) => o.value === t)?.emoji ?? "📄";
}

function nowDateTimeLocal(): string {
  const now = new Date();
  now.setSeconds(0, 0);
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

function isoToDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  d.setSeconds(0, 0);
  const offset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

export function MedicalRecordsView({ catId, catName, themeColor, onBack }: Props) {
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [attachmentsByRecord, setAttachmentsByRecord] = useState<
    Record<string, MedicalRecordAttachment[]>
  >({});
  const [type, setType] = useState<MedicalRecord["type"]>("blood_test");
  const [recordedAt, setRecordedAt] = useState(nowDateTimeLocal);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRecordedAt, setEditRecordedAt] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  // 解析結果は attachment 単位で持つ。recordedAt は親 record.recorded_at の写し
  // (cross-attachment 時系列を組む時の date 軸として使う)。
  const [analysisByAttachment, setAnalysisByAttachment] = useState<
    Record<string, { state: PanelState; recordedAt: string }>
  >({});
  const [analyzingAttachmentId, setAnalyzingAttachmentId] = useState<string | null>(null);

  // 全 succeeded analysis を 1 個の cross-attachment series に展開。前回比の計算に使う。
  // analyses が増減した時だけ再計算。
  const series = useMemo(() => {
    const input: AnalysisForDisplay[] = [];
    for (const entry of Object.values(analysisByAttachment)) {
      if (entry.state.kind === "succeeded") {
        input.push({ recordedAt: entry.recordedAt, values: entry.state.values });
      }
    }
    return buildItemSeries(input);
  }, [analysisByAttachment]);

  useEffect(() => {
    (async () => {
      const result = await listMedicalRecords(catId);
      if (result.isErr()) {
        setError(result.error.message);
        return;
      }
      setRecords(result.value);
      // 各 record の attachments を並列で取得 (家族規模なので N+1 を許容)
      const pairs = await Promise.all(
        result.value.map(async (r) => [r.id, await listMedicalAttachments(catId, r.id)] as const),
      );
      const map: Record<string, MedicalRecordAttachment[]> = {};
      for (const [rid, res] of pairs) {
        if (res.isErr()) {
          setError(res.error.message);
          return;
        }
        map[rid] = res.value;
      }
      setAttachmentsByRecord(map);

      // blood_test record の inline 表示可能な画像 attachment に対し analysis を並列フェッチ。
      // HEIC/HEIF は AI 解析対象外 (Workers AI Gemma が webp/jpeg/png のみ受け付ける)。
      const recordById: Record<string, MedicalRecord> = Object.fromEntries(
        result.value.map((r) => [r.id, r]),
      );
      const analysisFetches: Array<
        Promise<readonly [string, { state: PanelState; recordedAt: string } | null]>
      > = [];
      for (const [rid, attachments] of Object.entries(map)) {
        const record = recordById[rid];
        if (!record || record.type !== "blood_test") continue;
        for (const a of attachments) {
          if (!ANALYZABLE_TYPES.has(a.contentType)) continue;
          analysisFetches.push(
            (async () => {
              const r = await getBloodTestAnalysis(catId, rid, a.id);
              if (r.isErr()) {
                if (r.error.kind === "http" && r.error.status === 404) {
                  return [
                    a.id,
                    { state: { kind: "missing" } as PanelState, recordedAt: record.recordedAt },
                  ] as const;
                }
                return [a.id, null] as const;
              }
              const { analysis, values } = r.value;
              const state: PanelState =
                analysis.status === "succeeded"
                  ? { kind: "succeeded", analysis, values }
                  : analysis.status === "pending"
                    ? { kind: "pending" }
                    : analysis.status === "running"
                      ? { kind: "running" }
                      : { kind: "failed", errorMessage: analysis.errorMessage ?? "解析失敗" };
              return [a.id, { state, recordedAt: record.recordedAt }] as const;
            })(),
          );
        }
      }
      const analysisResults = await Promise.all(analysisFetches);
      const analysisMap: Record<string, { state: PanelState; recordedAt: string }> = {};
      for (const [aid, entry] of analysisResults) {
        if (entry) analysisMap[aid] = entry;
      }
      setAnalysisByAttachment(analysisMap);
    })();
  }, [catId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const iso = new Date(recordedAt).toISOString();
    const result = await createMedicalRecord(catId, {
      type,
      recordedAt: iso,
      title: title.trim() === "" ? null : title.trim(),
      notes: notes.trim() === "" ? null : notes.trim(),
    });
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    const created = result.value;
    withViewTransition(() => {
      setRecords((prev) =>
        [created, ...prev].sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1)),
      );
      setAttachmentsByRecord((prev) => ({ ...prev, [created.id]: [] }));
      setTitle("");
      setNotes("");
    });
  }

  function startEdit(r: MedicalRecord) {
    setEditingId(r.id);
    setEditRecordedAt(isoToDateTimeLocal(r.recordedAt));
    setEditTitle(r.title ?? "");
    setEditNotes(r.notes ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditRecordedAt("");
    setEditTitle("");
    setEditNotes("");
  }

  async function saveEdit(r: MedicalRecord) {
    setError(null);
    const iso = new Date(editRecordedAt).toISOString();
    const result = await updateMedicalRecord(catId, r.id, {
      type: r.type,
      recordedAt: iso,
      title: editTitle.trim() === "" ? null : editTitle.trim(),
      notes: editNotes.trim() === "" ? null : editNotes.trim(),
    });
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    const updated = result.value;
    withViewTransition(() => {
      setRecords((prev) =>
        prev
          .map((x) => (x.id === r.id ? updated : x))
          .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1)),
      );
      cancelEdit();
    });
  }

  async function handleDelete(id: string) {
    setError(null);
    const result = await deleteMedicalRecord(catId, id);
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    withViewTransition(() => {
      setRecords((prev) => prev.filter((r) => r.id !== id));
      setAttachmentsByRecord((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });
  }

  async function handleUpload(recordId: string, file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploadingId(recordId);
    try {
      const result = await uploadMedicalAttachment(catId, recordId, file);
      if (result.isErr()) {
        setError(result.error.message);
        return;
      }
      const created = result.value;
      const record = records.find((r) => r.id === recordId);
      withViewTransition(() => {
        setAttachmentsByRecord((prev) => ({
          ...prev,
          [recordId]: [created, ...(prev[recordId] ?? [])],
        }));
        // blood_test + 解析可能 MIME なら Workflow が backend で自動 kick されるので
        // 「解析中」として state を埋める。実際の values は次回 reload で取得される。
        if (record?.type === "blood_test" && ANALYZABLE_TYPES.has(created.contentType)) {
          setAnalysisByAttachment((prev) => ({
            ...prev,
            [created.id]: { state: { kind: "running" }, recordedAt: record.recordedAt },
          }));
        }
      });
    } finally {
      setUploadingId(null);
    }
  }

  async function handleDeleteAttachment(recordId: string, attachmentId: string) {
    setError(null);
    const result = await deleteMedicalAttachment(catId, recordId, attachmentId);
    if (result.isErr()) {
      setError(result.error.message);
      return;
    }
    withViewTransition(() => {
      setAttachmentsByRecord((prev) => ({
        ...prev,
        [recordId]: (prev[recordId] ?? []).filter((a) => a.id !== attachmentId),
      }));
      setAnalysisByAttachment((prev) => {
        const next = { ...prev };
        delete next[attachmentId];
        return next;
      });
    });
  }

  async function handleAnalyze(
    recordId: string,
    attachmentId: string,
    attachmentRecordedAt: string,
  ) {
    setError(null);
    setAnalyzingAttachmentId(attachmentId);
    try {
      const result = await triggerBloodTestAnalyze(catId, recordId, attachmentId);
      if (result.isErr()) {
        setError(result.error.message);
        return;
      }
      // Workflow が走り始める。実際の values は完了後の reload で取得される (1〜数分後)。
      setAnalysisByAttachment((prev) => ({
        ...prev,
        [attachmentId]: { state: { kind: "running" }, recordedAt: attachmentRecordedAt },
      }));
    } finally {
      setAnalyzingAttachmentId(null);
    }
  }

  return (
    <section>
      <button type="button" onClick={onBack}>
        ← 戻る
      </button>

      <h2>{catName} の医療記録</h2>

      <form onSubmit={handleCreate}>
        <fieldset>
          <legend>種類</legend>
          {TYPE_OPTIONS.map((o) => (
            <label key={o.value} aria-label={o.label}>
              <input
                type="radio"
                name="type"
                value={o.value}
                checked={type === o.value}
                onChange={() => setType(o.value)}
              />
              {o.emoji} {o.label}
            </label>
          ))}
        </fieldset>

        <label>
          検査日
          <input
            type="datetime-local"
            value={recordedAt}
            onChange={(e) => setRecordedAt(e.target.value)}
            required
          />
        </label>

        <label>
          タイトル
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例: 春の定期健診"
            maxLength={100}
          />
        </label>

        <label>
          メモ
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="検査結果の所見など"
            maxLength={2000}
            rows={4}
          />
        </label>

        <button type="submit">追加</button>
      </form>

      {error && <p className="error-text">エラー: {error}</p>}

      {records.length === 0 ? (
        <p>記録がありません</p>
      ) : (
        <ul>
          {records.map((r) => (
            <li
              key={r.id}
              className="record-item"
              data-cat-theme={themeColor}
              style={{ viewTransitionName: `medical-${r.id}` }}
            >
              {editingId === r.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveEdit(r);
                  }}
                >
                  <label>
                    検査日
                    <input
                      type="datetime-local"
                      value={editRecordedAt}
                      onChange={(e) => setEditRecordedAt(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    タイトル
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      maxLength={100}
                    />
                  </label>
                  <label>
                    メモ
                    <textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      maxLength={2000}
                      rows={4}
                    />
                  </label>
                  <button type="submit">保存</button>
                  <button type="button" onClick={cancelEdit}>
                    取消
                  </button>
                </form>
              ) : (
                <>
                  <div>
                    <time dateTime={r.recordedAt}>{new Date(r.recordedAt).toLocaleString()}</time>{" "}
                    {typeEmoji(r.type)} {typeLabel(r.type)}
                    {r.title ? `: ${r.title}` : ""}
                  </div>
                  {r.notes && <p>{r.notes}</p>}

                  <div className="attachments">
                    {(attachmentsByRecord[r.id] ?? []).map((a) => {
                      const url = medicalAttachmentUrl(catId, r.id, a.id);
                      const isInlineImage = INLINE_IMAGE_TYPES.has(a.contentType);
                      const showPanel =
                        r.type === "blood_test" &&
                        ANALYZABLE_TYPES.has(a.contentType) &&
                        analysisByAttachment[a.id];
                      return (
                        <Fragment key={a.id}>
                          <div className="attachment">
                            {isInlineImage ? (
                              <a href={url} target="_blank" rel="noreferrer">
                                <img
                                  src={url}
                                  alt={a.originalFilename ?? "添付画像"}
                                  loading="lazy"
                                />
                              </a>
                            ) : (
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                download={a.originalFilename ?? undefined}
                              >
                                📎 {a.originalFilename ?? a.contentType}
                              </a>
                            )}
                            <ConfirmButton
                              popoverId={`del-att-${a.id}`}
                              triggerLabel="🗑️"
                              triggerAriaLabel="添付を削除"
                              message="この添付を削除しますか？"
                              confirmLabel="削除する"
                              onConfirm={() => handleDeleteAttachment(r.id, a.id)}
                            />
                          </div>
                          {showPanel && (
                            <BloodTestAnalysisPanel
                              state={analysisByAttachment[a.id].state}
                              series={series}
                              recordedAt={analysisByAttachment[a.id].recordedAt}
                              themeColor={themeColor}
                              analyzing={analyzingAttachmentId === a.id}
                              onAnalyze={() =>
                                handleAnalyze(r.id, a.id, analysisByAttachment[a.id].recordedAt)
                              }
                            />
                          )}
                        </Fragment>
                      );
                    })}
                    <label className="attachment-add">
                      <input
                        type="file"
                        accept={ACCEPT_MIMES}
                        hidden
                        disabled={uploadingId === r.id}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          // 同じファイルを連続選択できるよう input をリセット
                          e.target.value = "";
                          void handleUpload(r.id, f);
                        }}
                      />
                      {uploadingId === r.id ? "📎 アップロード中…" : "📎 追加"}
                    </label>
                  </div>

                  <button type="button" aria-label="記録を編集" onClick={() => startEdit(r)}>
                    ✏️
                  </button>
                  <ConfirmButton
                    popoverId={`del-medical-${r.id}`}
                    triggerLabel="🗑️"
                    triggerAriaLabel="記録を削除"
                    message="この医療記録と関連する添付ファイルを削除しますか？"
                    confirmLabel="削除する"
                    onConfirm={() => handleDelete(r.id)}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
