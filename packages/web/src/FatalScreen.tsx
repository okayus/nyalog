import { ErrorText } from "./components/ErrorText";

// 例外で React がツリーを外したあと、main.tsx がその場所に描く画面。
// state も fetch も props も持たせない。ここが throw すると受ける先が無く、白紙に戻る。
export function FatalScreen() {
  return (
    <main>
      {/* App が外れると document.title を直す者がいないので、ここで持つ。React 19 が head へ上げる。 */}
      <title>表示できませんでした | nyalog</title>
      <h1>表示できませんでした</h1>
      <ErrorText>
        画面を表示している途中でエラーが起きました。再読み込みすると直ることがあります。
      </ErrorText>
      <button type="button" onClick={() => location.reload()}>
        再読み込み
      </button>
    </main>
  );
}
