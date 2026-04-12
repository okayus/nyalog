import { useEffect, useState } from "react";
import { CatList } from "./components/CatList";
import { ToiletRecordView } from "./components/ToiletRecordView";

type View = { kind: "cats" } | { kind: "toilet"; catId: string; catName: string };

export function App() {
  const [email, setEmail] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "cats" });

  useEffect(() => {
    fetch("/api/me")
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<{ email: string }>;
      })
      .then((data) => setEmail(data.email))
      .catch((e: Error) => setAuthError(e.message));
  }, []);

  return (
    <main>
      <h1>nyalog</h1>
      <p>猫の健康管理アプリ</p>
      {email && <p>ログイン中: {email}</p>}
      {authError && <p>認証エラー: {authError}</p>}

      {view.kind === "cats" ? (
        <CatList
          onSelect={(cat) => setView({ kind: "toilet", catId: cat.id, catName: cat.name })}
        />
      ) : (
        <ToiletRecordView
          catId={view.catId}
          catName={view.catName}
          onBack={() => setView({ kind: "cats" })}
        />
      )}
    </main>
  );
}
