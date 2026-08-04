import { flushSync } from "react-dom";

type ViewTransition = { finished: Promise<void> };
type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => ViewTransition;
};

// afterFinished は遷移が終わってから走る。focus 移動をここに置くのは、
// 遷移中の DOM (古い view のスナップショット) に focus を当てても意味がないため。
export function withViewTransition(update: () => void, afterFinished?: () => void): void {
  const doc = document as DocumentWithViewTransition;
  if (typeof doc.startViewTransition !== "function") {
    update();
    afterFinished?.();
    return;
  }
  const transition = doc.startViewTransition(() => {
    flushSync(update);
  });
  // skip された時に finished が reject することがあるので、成否どちらでも走らせる。
  const run = () => afterFinished?.();
  transition.finished.then(run, run);
}
