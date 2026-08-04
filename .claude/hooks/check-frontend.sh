#!/usr/bin/env bash
# Stop hook — ターン終了前に format / lint / 型を通す。
#
# 狙いは CI 往復の削減。commit → リレー push (60 秒 timer) → CI で 1 往復 3 分かかり、
# red の大半は format / lint / 型という安い種類なので、手元の 6 秒で潰す。
#
# 実行は必ずコンテナ側 (ADR-008)。ホストの pnpm は node_modules を消しにかかる。
# セッションがコンテナ内で走っている場合はそのまま実行する。
#
# 終了コード: 0 = 通過 or 対象ファイルなし / 2 = 失敗 (stderr が Claude に戻る)
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0

# 発火した証跡。hook の stdout は transcript に出ないので、「設定ミスで一度も
# 走っていない」と「走った上で素通り」を後から区別できない。空振りしている hook は
# 守られているつもりになるぶん無いより悪いので、1 行だけ残す (gitignore 済み)。
LOG=.claude/.hook-log
trace() { echo "$(date +%FT%T) check-frontend $1" >>"$LOG"; }

# Stop hook 自身が Stop を誘発する無限ループを避ける。
if [ "$(jq -r '.stop_hook_active // false' 2>/dev/null <<<"${HOOK_INPUT:-$(cat)}")" = "true" ]; then
  trace "skip (stop_hook_active)"
  exit 0
fi

# 触っていないターンでは走らせない。未追跡ファイルも見る。
# .mjs を含めるのは scripts/measure-ui.mjs も vp check の対象だから。
changed="$(git status --porcelain -- '*.ts' '*.tsx' '*.css' '*.mjs' | wc -l)"
if [ "$changed" -eq 0 ]; then
  trace "skip (対象ファイルの変更なし)"
  exit 0
fi

if [ -f /.dockerenv ]; then
  run() { sh -c "$1"; }
else
  run() { docker compose exec -T dev sh -c "$1"; }
fi

out="$(
  run 'cd packages/web \
    && ./node_modules/.bin/vp check \
    && ./node_modules/.bin/tsc --noEmit -p tsconfig.json \
    && ./node_modules/.bin/tsc --noEmit -p tsconfig.worker.json' 2>&1
)"
rc=$?

if [ "$rc" -ne 0 ]; then
  trace "FAIL ($changed files)"
  {
    echo "ターン終了前チェックが失敗した (vp check / tsc)。直してから終わること。"
    echo "$out" | tail -40
  } >&2
  exit 2
fi

trace "pass ($changed files)"
exit 0
