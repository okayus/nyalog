// :user-invalid は見た目だけの状態で、aria-invalid は自動では付かない。
// accessible-error-announcement ガイドの「Bridge Visual & Accessibility Layer」を
// そのまま実装する。CSS 側の見た目は index.css の base layer にある。
//
// :user-invalid は Baseline Widely available (2023-11-02) なので fallback は持たない。
// 未対応ブラウザでは赤枠と aria-invalid が出ないだけで、native validation の
// バブルとフォーム送信のブロックは効く (CLAUDE.md の graceful degradation 方針)。

const CONTROLS = "input, select, textarea";

function sync(target: EventTarget | null): void {
  if (!(target instanceof Element) || !target.matches(CONTROLS)) return;
  if (target.matches(":user-invalid")) {
    target.setAttribute("aria-invalid", "true");
  } else {
    target.removeAttribute("aria-invalid");
  }
}

export function initUserInvalidSync(): void {
  // blur は bubble しないので capture で拾う。
  document.addEventListener("blur", (e) => sync(e.target), true);
  // submit を押して弾かれた時。native validation が送信を止めるので submit イベントは
  // 発火しない。各コントロールに飛ぶ invalid を capture で拾うのが正しい入口。
  document.addEventListener("invalid", (e) => sync(e.target), true);
  // 直した瞬間に消す。付いている時だけ見るのはガイドの推奨どおり
  // (入力のたびに :user-invalid を評価すると、打鍵の途中で赤くなる)。
  document.addEventListener("input", (e) => {
    if (e.target instanceof Element && e.target.hasAttribute("aria-invalid")) sync(e.target);
  });
}
