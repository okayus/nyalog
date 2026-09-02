import { useEffect, useState } from "react";
import { type AuthUser, authApi } from "./api";
import { AuthView } from "./components/AuthView";
import { CredentialsView } from "./components/CredentialsView";
import { InviteView } from "./components/InviteView";
import { SpaceInvitesView } from "./components/SpaceInvitesView";
import { clearInviteLocation, readInviteToken } from "./invite-link";
import { MedicalRecordsView } from "./components/MedicalRecordsView";
import { TasksView } from "./components/TasksView";
import { TodayView } from "./components/TodayView";
import { ToiletRecordView } from "./components/ToiletRecordView";
import { VetCalendar } from "./components/VetCalendar";
import { WeightRecordView } from "./components/WeightRecordView";
import { withViewTransition } from "./view-transition";

type View =
  | { kind: "today" }
  | { kind: "toilet"; catId: string; catName: string; themeColor: string }
  | { kind: "medical"; catId: string; catName: string; themeColor: string }
  | { kind: "weight"; catId: string; catName: string; themeColor: string }
  | { kind: "tasks" }
  | { kind: "credentials" }
  | { kind: "invites" };

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; user: AuthUser };

// 固有の文脈を先頭に置く (accessibility ガイド「Front-load unique context」)。
function pageTitle(auth: AuthState, view: View, onInvitePage: boolean): string {
  if (auth.status === "loading") return "nyalog";
  // 招待の着地は view の外にいる (URL を消したあとも招待画面のまま)
  if (onInvitePage) return "招待 | nyalog";
  if (auth.status === "unauthenticated") return "サインイン | nyalog";
  switch (view.kind) {
    case "today":
      return "今日 | nyalog";
    case "tasks":
      return "タスク管理 | nyalog";
    case "credentials":
      return "パスキー管理 | nyalog";
    case "invites":
      return "メンバーを招待 | nyalog";
    case "toilet":
      return `${view.catName} のトイレ記録 | nyalog`;
    case "medical":
      return `${view.catName} の医療記録 | nyalog`;
    case "weight":
      return `${view.catName} の体重 | nyalog`;
  }
}

// 遷移先の見出しへ focus を移す。押したボタンごと DOM が消えるので、放っておくと
// focus が body に落ちてキーボード操作の位置を見失う。tabindex="-1" を持つ見出しは
// 各ビューが自分で宣言している (data-view-heading)。
function focusViewHeading(): void {
  document.querySelector<HTMLElement>("[data-view-heading]")?.focus();
}

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [view, setView] = useState<View>({ kind: "today" });
  // 起動時に 1 回だけ読む。router は入れない — 招待リンクは一度きりの入口で、
  // 着地したら通常の画面に戻る。
  const [inviteToken, setInviteToken] = useState<string | null>(() => readInviteToken());

  // トークンをアドレスバーから消す (履歴・スクショ・共有に残さない)。
  useEffect(() => {
    if (inviteToken !== null) clearInviteLocation();
    // 起動直後に 1 回だけ。以降 inviteToken を null にしても URL は既に消えている。
  }, []);

  useEffect(() => {
    authApi.me().then((result) => {
      result.match(
        (user) => setAuth({ status: "authenticated", user }),
        () => setAuth({ status: "unauthenticated" }),
      );
    });
  }, []);

  useEffect(() => {
    document.title = pageTitle(auth, view, inviteToken !== null);
  }, [auth, view, inviteToken]);

  function goTo(next: View) {
    withViewTransition(() => setView(next), focusViewHeading);
  }

  async function handleLogout() {
    await authApi.logout();
    withViewTransition(() => {
      setAuth({ status: "unauthenticated" });
      setView({ kind: "today" });
    }, focusViewHeading);
  }

  if (auth.status === "loading") {
    return (
      <main>
        <h1>nyalog</h1>
        <p>読み込み中...</p>
      </main>
    );
  }

  if (inviteToken !== null) {
    return (
      <main>
        <h1>nyalog</h1>
        <InviteView
          token={inviteToken}
          user={auth.status === "authenticated" ? auth.user : null}
          onJoined={(user) => {
            setAuth({ status: "authenticated", user });
            setInviteToken(null);
          }}
          onCancel={() => setInviteToken(null)}
        />
      </main>
    );
  }

  if (auth.status === "unauthenticated") {
    return (
      <main>
        <h1>nyalog</h1>
        <p>猫の健康管理アプリ</p>
        <AuthView onAuthenticated={(user) => setAuth({ status: "authenticated", user })} />
      </main>
    );
  }

  return (
    <main>
      <header>
        <h1>nyalog</h1>
        <button
          type="button"
          className="menu-trigger"
          popoverTarget="account-menu"
          aria-label="アカウントメニュー"
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div id="account-menu" popover="auto" className="account-menu">
          <p className="account-menu-user">ログイン中: {auth.user.displayName}</p>
          <button
            type="button"
            popoverTarget="account-menu"
            popoverTargetAction="hide"
            onClick={() => goTo({ kind: "credentials" })}
          >
            パスキー管理
          </button>
          <button
            type="button"
            popoverTarget="account-menu"
            popoverTargetAction="hide"
            onClick={() => goTo({ kind: "invites" })}
          >
            メンバーを招待
          </button>
          <button
            type="button"
            popoverTarget="account-menu"
            popoverTargetAction="hide"
            onClick={handleLogout}
          >
            ログアウト
          </button>
        </div>
      </header>

      {view.kind === "today" ? (
        <>
          <TodayView
            onOpenDetail={(cat) =>
              goTo({
                kind: "toilet",
                catId: cat.id,
                catName: cat.name,
                themeColor: cat.themeColor,
              })
            }
            onOpenMedical={(cat) =>
              goTo({
                kind: "medical",
                catId: cat.id,
                catName: cat.name,
                themeColor: cat.themeColor,
              })
            }
            onOpenWeight={(cat) =>
              goTo({
                kind: "weight",
                catId: cat.id,
                catName: cat.name,
                themeColor: cat.themeColor,
              })
            }
            onOpenTasks={() => goTo({ kind: "tasks" })}
          />
          <VetCalendar />
        </>
      ) : null}
      {view.kind === "tasks" ? <TasksView onBack={() => goTo({ kind: "today" })} /> : null}
      {view.kind === "toilet" ? (
        <ToiletRecordView
          catId={view.catId}
          catName={view.catName}
          themeColor={view.themeColor}
          onBack={() => goTo({ kind: "today" })}
        />
      ) : null}
      {view.kind === "medical" ? (
        <MedicalRecordsView
          catId={view.catId}
          catName={view.catName}
          themeColor={view.themeColor}
          onBack={() => goTo({ kind: "today" })}
        />
      ) : null}
      {view.kind === "weight" ? (
        <WeightRecordView
          catId={view.catId}
          catName={view.catName}
          themeColor={view.themeColor}
          onBack={() => goTo({ kind: "today" })}
        />
      ) : null}
      {view.kind === "credentials" ? (
        <CredentialsView onBack={() => goTo({ kind: "today" })} />
      ) : null}
      {view.kind === "invites" ? <SpaceInvitesView onBack={() => goTo({ kind: "today" })} /> : null}
    </main>
  );
}
