import { useEffect, useState } from "react";

export function App() {
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<{ email: string }>;
      })
      .then((data) => setEmail(data.email))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main>
      <h1>nyalog</h1>
      <p>猫の健康管理アプリ</p>
      {email && <p>ログイン中: {email}</p>}
      {error && <p>認証エラー: {error}</p>}
    </main>
  );
}
