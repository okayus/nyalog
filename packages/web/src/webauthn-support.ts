// PublicKeyCredential.getClientCapabilities() で「この端末でパスキーを作れるか」を見る。
// Baseline Newly available なので、未実装のブラウザでは判定を諦めて null (= 警告なし) を返す。
//
// 判定できた場合も *ボタンは塞がない*。nyalog の方針は「未対応でも機能が消えるだけで壊れない」で、
// プラットフォーム認証器が無くてもセキュリティキーなら登録できるため。警告文だけ出して、
// 実際に失敗したら create() の例外がそのままエラー表示に出る。
export async function passkeyWarning(): Promise<string | null> {
  if (typeof PublicKeyCredential === "undefined") {
    return "このブラウザはパスキーに対応していません。別のブラウザで開いてください。";
  }
  const getCapabilities = (
    PublicKeyCredential as unknown as {
      getClientCapabilities?: () => Promise<Record<string, boolean | undefined>>;
    }
  ).getClientCapabilities;
  if (typeof getCapabilities !== "function") return null;
  try {
    const capabilities = await getCapabilities.call(PublicKeyCredential);
    return capabilities.passkeyPlatformAuthenticator === false
      ? "この端末では画面ロック (Face ID / 指紋 / PIN) が未設定のようです。設定してから開き直すと登録できます。"
      : null;
  } catch {
    return null;
  }
}
