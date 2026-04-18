import { flushSync } from "react-dom";

type ViewTransition = { finished: Promise<void> };
type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => ViewTransition;
};

export function withViewTransition(update: () => void): void {
  const doc = document as DocumentWithViewTransition;
  if (typeof doc.startViewTransition === "function") {
    doc.startViewTransition(() => {
      flushSync(update);
    });
  } else {
    update();
  }
}
