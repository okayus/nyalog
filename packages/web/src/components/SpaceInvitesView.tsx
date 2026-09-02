import { useCallback, useEffect, useState } from "react";
import {
  type IssuedInvite,
  type PendingInvite,
  type SpaceSummary,
  describeApiError,
  spaceApi,
} from "../api";
import { ErrorText } from "./ErrorText";

type Props = {
  onBack: () => void;
};

export function SpaceInvitesView({ onBack }: Props) {
  const [spaces, setSpaces] = useState<SpaceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void spaceApi.list().then((result) =>
      result.match(setSpaces, (e) => {
        setError(describeApiError(e));
        setSpaces([]);
      }),
    );
  }, []);

  return (
    <section>
      <button type="button" onClick={onBack}>
        ← 戻る
      </button>
      <h2 tabIndex={-1} data-view-heading>
        メンバーを招待
      </h2>
      {error && <ErrorText>{error}</ErrorText>}
      {spaces === null ? (
        <p>読み込み中...</p>
      ) : (
        spaces.map((space) => <SpaceSection key={space.id} space={space} />)
      )}
    </section>
  );
}

function SpaceSection({ space }: { space: SpaceSummary }) {
  if (space.role !== "owner") {
    return (
      <article>
        <h3>{space.name}</h3>
        <p>招待リンクを作れるのはこのスペースのオーナーだけです。</p>
      </article>
    );
  }
  return (
    <article>
      <h3>{space.name}</h3>
      <InviteControls spaceId={space.id} />
    </article>
  );
}

function InviteControls({ spaceId }: { spaceId: string }) {
  const [pending, setPending] = useState<PendingInvite[]>([]);
  // 発行直後だけ手元にあるリンク。サーバは hash しか持たないので、閉じたら二度と出せない。
  const [issued, setIssued] = useState<IssuedInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canShare = typeof navigator.share === "function";

  const refresh = useCallback(async () => {
    const result = await spaceApi.listInvites(spaceId);
    result.match(setPending, (e) => setError(describeApiError(e)));
  }, [spaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleIssue() {
    setBusy(true);
    setError(null);
    setCopied(false);
    const result = await spaceApi.issueInvite(spaceId);
    if (result.isErr()) {
      setError(describeApiError(result.error));
      setBusy(false);
      return;
    }
    setIssued(result.value);
    await refresh();
    setBusy(false);
  }

  async function handleRevoke(inviteId: string) {
    setBusy(true);
    setError(null);
    const result = await spaceApi.revokeInvite(spaceId, inviteId);
    if (result.isErr()) {
      setError(describeApiError(result.error));
      setBusy(false);
      return;
    }
    if (issued?.inviteId === inviteId) setIssued(null);
    await refresh();
    setBusy(false);
  }

  async function handleCopy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.url);
      setCopied(true);
    } catch {
      // 権限拒否や非セキュアコンテキスト。下の入力欄から手で選べるので機能は死なない。
      setError("コピーできませんでした。下のリンクを選択してコピーしてください。");
    }
  }

  async function handleShare() {
    if (!issued) return;
    await navigator.share({ title: "nyalog への招待", url: issued.url }).catch(() => {});
  }

  return (
    <>
      <p>招待リンクは 7 日間・1 回だけ使えます。家族に直接送ってください。</p>
      <button type="button" onClick={handleIssue} disabled={busy}>
        招待リンクを作る
      </button>

      {issued && (
        <div>
          <label>
            招待リンク (この画面を離れると二度と表示されません)
            <input
              type="text"
              readOnly
              value={issued.url}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          <button type="button" onClick={handleCopy}>
            {copied ? "コピーしました" : "コピー"}
          </button>
          {canShare && (
            <button type="button" onClick={handleShare}>
              共有
            </button>
          )}
          <p>有効期限: {new Date(issued.expiresAt).toLocaleString()}</p>
        </div>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      {pending.length > 0 && (
        <>
          <h4>未使用の招待</h4>
          <ul>
            {pending.map((invite) => (
              <li key={invite.id}>
                <span>{new Date(invite.expiresAt).toLocaleString()} まで有効</span>
                <button
                  type="button"
                  onClick={() => handleRevoke(invite.id)}
                  disabled={busy}
                  aria-label="この招待を取り消す"
                  title="この招待を取り消す"
                >
                  🗑️
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
