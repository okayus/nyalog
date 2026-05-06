import { useEffect, useState } from "react";
import { type AuthUser, authApi } from "./api";
import { AuthView } from "./components/AuthView";
import { CredentialsView } from "./components/CredentialsView";
import { MedicalRecordsView } from "./components/MedicalRecordsView";
import { TodayView } from "./components/TodayView";
import { ToiletRecordView } from "./components/ToiletRecordView";
import { VetCalendar } from "./components/VetCalendar";
import { withViewTransition } from "./view-transition";

type View =
  | { kind: "today" }
  | { kind: "toilet"; catId: string; catName: string; themeColor: string }
  | { kind: "medical"; catId: string; catName: string; themeColor: string }
  | { kind: "credentials" };

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; user: AuthUser };

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [view, setView] = useState<View>({ kind: "today" });

  useEffect(() => {
    authApi.me().then((result) => {
      result.match(
        (user) => setAuth({ status: "authenticated", user }),
        () => setAuth({ status: "unauthenticated" }),
      );
    });
  }, []);

  async function handleLogout() {
    await authApi.logout();
    withViewTransition(() => {
      setAuth({ status: "unauthenticated" });
      setView({ kind: "today" });
    });
  }

  if (auth.status === "loading") {
    return (
      <main>
        <h1>nyalog</h1>
        <p>読み込み中...</p>
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
      <h1>nyalog</h1>
      <p>猫の健康管理アプリ</p>
      <header>
        <span>ログイン中: {auth.user.displayName}</span>{" "}
        <button
          type="button"
          onClick={() => withViewTransition(() => setView({ kind: "credentials" }))}
        >
          パスキー管理
        </button>{" "}
        <button type="button" onClick={handleLogout}>
          ログアウト
        </button>
      </header>

      {view.kind === "today" ? (
        <>
          <TodayView
            onOpenDetail={(cat) =>
              withViewTransition(() =>
                setView({
                  kind: "toilet",
                  catId: cat.id,
                  catName: cat.name,
                  themeColor: cat.themeColor,
                }),
              )
            }
            onOpenMedical={(cat) =>
              withViewTransition(() =>
                setView({
                  kind: "medical",
                  catId: cat.id,
                  catName: cat.name,
                  themeColor: cat.themeColor,
                }),
              )
            }
          />
          <VetCalendar />
        </>
      ) : null}
      {view.kind === "toilet" ? (
        <ToiletRecordView
          catId={view.catId}
          catName={view.catName}
          themeColor={view.themeColor}
          onBack={() => withViewTransition(() => setView({ kind: "today" }))}
        />
      ) : null}
      {view.kind === "medical" ? (
        <MedicalRecordsView
          catId={view.catId}
          catName={view.catName}
          themeColor={view.themeColor}
          onBack={() => withViewTransition(() => setView({ kind: "today" }))}
        />
      ) : null}
      {view.kind === "credentials" ? (
        <CredentialsView onBack={() => withViewTransition(() => setView({ kind: "today" }))} />
      ) : null}
    </main>
  );
}
