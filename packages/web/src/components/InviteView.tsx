import { useEffect, useState } from "react";
import { type AuthUser, authApi, describeApiError, spaceApi } from "../api";
import { passkeyWarning } from "../webauthn-support";
import { ErrorText } from "./ErrorText";

type Props = {
  token: string;
  /** 未ログインなら null。ログイン済みならそのユーザー。 */
  user: AuthUser | null;
  onJoined: (user: AuthUser) => void;
  onCancel: () => void;
};

// 招待リンクの着地点。未ログインならパスキーを作って参加、ログイン済みならそのまま参加する。
export function InviteView({ token, user, onJoined, onCancel }: Props) {
  return user ? (
    <AcceptAsExistingUser token={token} user={user} onJoined={onJoined} onCancel={onCancel} />
  ) : (
    <RegisterViaInvite token={token} onJoined={onJoined} onCancel={onCancel} />
  );
}

function AcceptAsExistingUser({
  token,
  user,
  onJoined,
  onCancel,
}: {
  token: string;
  user: AuthUser;
  onJoined: (user: AuthUser) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    setBusy(true);
    setError(null);
    const result = await spaceApi.accept(token);
    result.match(
      () => onJoined(user),
      (e) => {
        setError(describeApiError(e));
        setBusy(false);
      },
    );
  }

  return (
    <section>
      <h2 tabIndex={-1} data-view-heading>
        スペースに招待されました
      </h2>
      <p>
        <strong>{user.displayName}</strong> として参加します。
      </p>
      <button type="button" onClick={handleJoin} disabled={busy}>
        参加する
      </button>
      <button type="button" onClick={onCancel} disabled={busy}>
        参加せずに戻る
      </button>
      {error && <ErrorText>{error}</ErrorText>}
    </section>
  );
}

function RegisterViaInvite({
  token,
  onJoined,
  onCancel,
}: {
  token: string;
  onJoined: (user: AuthUser) => void;
  onCancel: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    void passkeyWarning().then(setWarning);
  }, []);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await authApi.register(
      displayName.trim(),
      { kind: "invite", inviteToken: token },
      deviceName.trim() || null,
    );
    result.match(onJoined, (e) => {
      setError(describeApiError(e));
      setBusy(false);
    });
  }

  // 既にアカウントを持っている人がリンクを開いた場合。ログインすれば
  // App 側の user が埋まり、AcceptAsExistingUser に切り替わる。
  async function handleLogin() {
    setBusy(true);
    setError(null);
    const result = await authApi.login();
    result.match(onJoined, (e) => {
      setError(describeApiError(e));
      setBusy(false);
    });
  }

  return (
    <section>
      <h2 tabIndex={-1} data-view-heading>
        nyalog に招待されました
      </h2>
      <p>表示名を決めて、この端末にパスキーを作ると参加できます。</p>
      {warning && <p role="status">{warning}</p>}

      <form onSubmit={handleRegister}>
        <label>
          表示名
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            minLength={1}
            maxLength={50}
            autoComplete="nickname"
          />
        </label>
        <label>
          デバイス名 (任意)
          <input
            type="text"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            maxLength={80}
            placeholder="例: iPhone"
          />
        </label>
        {/* 未入力でも押させる。押せば native validation が空の required を :user-invalid にして
            最初の 1 つへ focus を移す (forms / required-field-feedback ガイド)。 */}
        <button type="submit" disabled={busy}>
          パスキーを作って参加
        </button>
      </form>

      <p>すでに nyalog のアカウントがある場合:</p>
      <button type="button" onClick={handleLogin} disabled={busy}>
        パスキーでログインして参加
      </button>
      <button type="button" onClick={onCancel} disabled={busy}>
        参加せずに戻る
      </button>

      {error && <ErrorText>{error}</ErrorText>}
    </section>
  );
}
