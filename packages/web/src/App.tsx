import { useEffect, useState } from "react";
import { type AuthUser, ApiError, authApi } from "./api";
import { AuthView } from "./components/AuthView";
import { CatList } from "./components/CatList";
import { CredentialsView } from "./components/CredentialsView";
import { ToiletRecordView } from "./components/ToiletRecordView";

type View =
  | { kind: "cats" }
  | { kind: "toilet"; catId: string; catName: string }
  | { kind: "credentials" };

type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; user: AuthUser };

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [view, setView] = useState<View>({ kind: "cats" });

  useEffect(() => {
    authApi
      .me()
      .then((user) => setAuth({ status: "authenticated", user }))
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) {
          setAuth({ status: "unauthenticated" });
        } else {
          setAuth({ status: "unauthenticated" });
        }
      });
  }, []);

  async function handleLogout() {
    try {
      await authApi.logout();
    } finally {
      setAuth({ status: "unauthenticated" });
      setView({ kind: "cats" });
    }
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
        <button type="button" onClick={() => setView({ kind: "credentials" })}>
          パスキー管理
        </button>{" "}
        <button type="button" onClick={handleLogout}>
          ログアウト
        </button>
      </header>

      {view.kind === "cats" && (
        <CatList
          onSelect={(cat) => setView({ kind: "toilet", catId: cat.id, catName: cat.name })}
        />
      )}
      {view.kind === "toilet" && (
        <ToiletRecordView
          catId={view.catId}
          catName={view.catName}
          onBack={() => setView({ kind: "cats" })}
        />
      )}
      {view.kind === "credentials" && <CredentialsView onBack={() => setView({ kind: "cats" })} />}
    </main>
  );
}
