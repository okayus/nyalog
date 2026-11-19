import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { FatalScreen } from "./FatalScreen";
import "./index.css";
import { initUserInvalidSync } from "./user-invalid";

// document 全体の capture listener なので、React の外側で 1 回だけ張る。
initUserInvalidSync();

const root = createRoot(document.getElementById("root")!, {
  // エラー境界を置いていないので、描画や effect の例外はすべてここへ来る。React 19 は
  // ツリーを外し終えてから呼ぶので、何も描かなければ白紙のままになる。reportError は
  // 既定のハンドラと同じ報告先で、console と window の error に出る。
  onUncaughtError(error) {
    reportError(error);
    root.render(<FatalScreen />);
  },
});

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
