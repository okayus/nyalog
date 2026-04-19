import { useEffect, useState } from "react";
import { type CredentialSummary, authApi } from "../api";

type Props = {
  onBack: () => void;
};

export function CredentialsView({ onBack }: Props) {
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setCredentials(await authApi.listCredentials());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.addCredential(deviceName.trim() || null);
      setDeviceName("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    setError(null);
    try {
      await authApi.deleteCredential(id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canDelete = credentials.length > 1;

  return (
    <section>
      <button type="button" onClick={onBack}>
        ← 戻る
      </button>
      <h2>パスキー管理</h2>

      <form onSubmit={handleAdd}>
        <label>
          デバイス名 (任意)
          <input
            type="text"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            maxLength={80}
          />
        </label>
        <button type="submit" disabled={busy}>
          このデバイスのパスキーを追加
        </button>
      </form>

      {error && <p className="error-text">エラー: {error}</p>}

      <ul>
        {credentials.map((c) => (
          <li key={c.id}>
            <strong>{c.deviceName ?? "(無名)"}</strong>
            <span> 追加: {new Date(c.createdAt).toLocaleString()}</span>
            {c.lastUsedAt && <span> / 最終使用: {new Date(c.lastUsedAt).toLocaleString()}</span>}
            <button
              type="button"
              onClick={() => handleDelete(c.id)}
              disabled={busy || !canDelete}
              aria-label={canDelete ? "パスキーを削除" : "最後の1つは削除できません"}
              title={canDelete ? "パスキーを削除" : "最後の1つは削除できません"}
            >
              🗑️
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
