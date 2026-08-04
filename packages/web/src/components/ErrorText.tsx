import { useEffect } from "react";
import { announce } from "../announce";

type Props = { children: string };

// 見えるエラー表示と支援技術への通知を 1 箇所にまとめる。7 ビュー + 血液検査パネルで
// 同じ形を書いていたので、通知の作法もここに集約する (announce.ts の常設 region へ流す)。
//
// アイコンを必ず添えるのは、色だけで状態を伝えないため
// (required-field-feedback ガイドの MANDATORY)。.error-text は色しか持っていなかった。
export function ErrorText({ children }: Props) {
  useEffect(() => {
    announce(children);
  }, [children]);

  return (
    <p className="error-text">
      <span aria-hidden="true">⚠️</span> {children}
    </p>
  );
}
