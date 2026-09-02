// 招待リンク /invite#token=... の読み取り。
//
// router は入れない: 招待リンクは「一度きりの入口」で、着地したらすぐ通常の画面に戻る。
// 起動時に 1 回読むだけで足りる (worker の notFound が ASSETS に落とすので /invite は SPA を返す)。
export function readInviteToken(): string | null {
  if (location.pathname !== "/invite") return null;
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  return token && token.length > 0 ? token : null;
}

// アドレスバーからトークンを消す。履歴・スクショ・共有に残さない。
export function clearInviteLocation(): void {
  history.replaceState(null, "", "/");
}
