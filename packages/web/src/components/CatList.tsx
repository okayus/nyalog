import { useEffect, useState } from "react";
import type { Cat } from "../../worker/domain/cat";
import { createCat, deleteCat, listCats } from "../api";

type Props = {
  onSelect: (cat: Cat) => void;
};

export function CatList({ onSelect }: Props) {
  const [cats, setCats] = useState<Cat[]>([]);
  const [name, setName] = useState("");
  const [birthday, setBirthday] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setCats(await listCats());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createCat({ name, birthday: birthday || null });
      setName("");
      setBirthday("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("この猫を削除しますか？（紐づくトイレ記録も消えます）")) return;
    try {
      await deleteCat(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section>
      <h2>猫一覧</h2>

      <form onSubmit={handleCreate}>
        <input
          type="text"
          placeholder="名前"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
        <button type="submit">追加</button>
      </form>

      {error && <p style={{ color: "red" }}>エラー: {error}</p>}

      {cats.length === 0 ? (
        <p>まだ登録されていません</p>
      ) : (
        <ul>
          {cats.map((cat) => (
            <li key={cat.id}>
              <strong>{cat.name}</strong>
              {cat.birthday && ` (${cat.birthday})`}{" "}
              <button type="button" onClick={() => onSelect(cat)}>
                トイレ記録
              </button>{" "}
              <button type="button" onClick={() => handleDelete(cat.id)}>
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
