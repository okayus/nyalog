// ページに 1 つだけ置く live region。
//
// エラーが出た時に role="alert" の要素を新しく mount する形だと、要素の出現自体を
// 支援技術が拾い損ねることがある。accessibility ガイドの「Centralize live regions」に
// 従い、常設の region を 1 つ持ってそこへ書き込む。
//
// urgency は assertive (role="alert")。ここへ流すのは API 失敗だけで、ガイドの
// urgency table が Critical に置いている種類にあたる。読み込み中などの
// interstitial state は流さない (ノイズにしかならない、と同ガイドの DON'T)。

const region = document.createElement("div");
region.setAttribute("role", "alert");
region.className = "visually-hidden";
document.body.append(region);

let pending: ReturnType<typeof setTimeout> | undefined;

export function announce(message: string): void {
  clearTimeout(pending);
  // 一度空にしてから書き直す。同じ文言が続いた時に読み直させるため。
  region.textContent = "";
  // 少し遅らせるのは、focus 移動など他の読み上げと衝突させないため
  // (accessibility ガイド「Delay slightly when other announcements may collide」)。
  pending = setTimeout(() => {
    region.textContent = message;
  }, 100);
}
