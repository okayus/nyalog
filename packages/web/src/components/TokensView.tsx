import { useEffect, useState } from "react";
import { SCOPES, type Scope } from "../../worker/domain/pat";
import { type IssuedToken, type TokenSummary, describeApiError, tokenApi } from "../api";
import { ErrorText } from "./ErrorText";

const SCOPE_LABELS: Record<Scope, string> = {
  "toilet:read": "トイレ記録を読む",
  "toilet:write": "トイレ記録を付ける・取り消す",
  "tasks:read": "タスクの予定を読む",
  "tasks:write": "タスクを完了にする・取り消す",
};

function toggleScope(selected: readonly Scope[], scope: Scope): Scope[] {
  return selected.includes(scope) ? selected.filter((s) => s !== scope) : [...selected, scope];
}

type Props = {
  onBack: () => void;
};

// PAT の発行・一覧・失効 (ADR-009)。発行直後の平文はこのコンポーネントの state にしか置かない。
// 画面を離れると消える、が「今だけ表示」の約束。
export function TokensView({ onBack }: Props) {
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [name, setName] = useState("");
  // 既定は何も選ばない。渡す先に要るものだけを選んでもらう
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const result = await tokenApi.list();
    result.match(setTokens, (e) => setError(describeApiError(e)));
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCopied(false);
    const result = await tokenApi.create(name.trim(), scopes);
    if (result.isErr()) {
      setError(describeApiError(result.error));
      setBusy(false);
      return;
    }
    setIssued(result.value);
    setName("");
    setScopes([]);
    await refresh();
    setBusy(false);
  }

  async function handleRevoke(id: string) {
    setBusy(true);
    setError(null);
    const result = await tokenApi.revoke(id);
    if (result.isErr()) {
      setError(describeApiError(result.error));
      setBusy(false);
      return;
    }
    if (issued?.id === id) setIssued(null);
    await refresh();
    setBusy(false);
  }

  async function handleCopy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.token);
      setCopied(true);
    } catch {
      setError("コピーできませんでした。上の欄を選択してコピーしてください。");
    }
  }

  return (
    <section>
      <button type="button" onClick={onBack}>
        ← 戻る
      </button>
      <h2 tabIndex={-1} data-view-heading>
        API トークン
      </h2>
      <p>
        ochanoma などの機械が、あなたとして記録を読み書きするための Bearer
        トークンです。発行直後に一度だけ表示されます。権限は渡す先に要るものだけを選んでください。
      </p>

      <form onSubmit={handleCreate}>
        <label>
          トークン名
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="例: ochanoma"
            required
          />
        </label>
        <fieldset>
          <legend>権限</legend>
          {SCOPES.map((s) => (
            <label key={s}>
              <input
                type="checkbox"
                checked={scopes.includes(s)}
                onChange={() => setScopes((prev) => toggleScope(prev, s))}
              />
              <span>
                {SCOPE_LABELS[s]} <code>{s}</code>
              </span>
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={busy || !name.trim() || scopes.length === 0}>
          発行
        </button>
      </form>

      {issued && (
        <div>
          <label>
            {issued.name} のトークン (この画面を離れると二度と表示されません)
            <input
              type="text"
              readOnly
              value={issued.token}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          <button type="button" onClick={handleCopy}>
            {copied ? "コピーしました" : "コピー"}
          </button>
          <p>権限: {issued.scopes.join(", ")}</p>
        </div>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      <ul>
        {tokens.map((t) => (
          <li key={t.id}>
            <strong>{t.name}</strong>
            <span> 権限: {t.scopes.join(", ")}</span>
            <span> / 作成: {new Date(t.createdAt).toLocaleString()}</span>
            <span>
              {" "}
              / 最終使用: {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "未使用"}
            </span>
            {t.revokedAt ? (
              <span> / 失効済み ({new Date(t.revokedAt).toLocaleString()})</span>
            ) : (
              <button
                type="button"
                onClick={() => handleRevoke(t.id)}
                disabled={busy}
                aria-label={`${t.name} を失効`}
                title="このトークンを失効"
              >
                🗑️
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
