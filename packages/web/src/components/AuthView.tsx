import { useState } from "react";
import { type AuthUser, authApi } from "../api";

type Props = {
  onAuthenticated: (user: AuthUser) => void;
};

export function AuthView({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [token, setToken] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setBusy(true);
    setError(null);
    try {
      onAuthenticated(await authApi.login());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await authApi.register(
        displayName.trim(),
        token.trim(),
        deviceName.trim() || null,
      );
      onAuthenticated(user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>サインイン</h2>
      <nav>
        <button type="button" onClick={() => setMode("login")} disabled={mode === "login" || busy}>
          ログイン
        </button>
        <button
          type="button"
          onClick={() => setMode("register")}
          disabled={mode === "register" || busy}
        >
          新規登録
        </button>
      </nav>

      {mode === "login" ? (
        <div>
          <p>登録済みのパスキーでログインします。</p>
          <button type="button" onClick={handleLogin} disabled={busy}>
            パスキーでログイン
          </button>
        </div>
      ) : (
        <form onSubmit={handleRegister}>
          <p>初回登録には招待トークンが必要です。</p>
          <label>
            表示名
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              minLength={1}
              maxLength={50}
            />
          </label>
          <label>
            招待トークン
            <input type="text" value={token} onChange={(e) => setToken(e.target.value)} required />
          </label>
          <label>
            デバイス名 (任意)
            <input
              type="text"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              maxLength={80}
            />
          </label>
          <button type="submit" disabled={busy || !displayName.trim() || !token.trim()}>
            パスキーを登録
          </button>
        </form>
      )}

      {error && <p style={{ color: "crimson" }}>エラー: {error}</p>}
    </section>
  );
}
