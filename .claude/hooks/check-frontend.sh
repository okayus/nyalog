#!/usr/bin/env bash
# format / lint / 型 (vp check と tsc ×2。CI の check job と同じ) を通す。2 つの場面で呼ばれる:
#  - PreToolUse (settings.json の if で git commit に絞る): commit の前。commit は 60 秒以内に
#    リレーが push するので、ここで落とさないと CI の往復 (約 3 分) になる。
#  - Stop: ターンの終わりに、commit していない変更が残っているとき。
# 対象のファイルに変更が無いとき、同じ中身で一度通っているときは走らせない。
#
# 実行は必ずコンテナ側 (ADR-008)。ホストの pnpm は node_modules を消しにかかる。
# セッションがコンテナ内で走っている場合はそのまま実行する。
#
# 終了コード: 0 = 通過 or 対象外 / 2 = 失敗 (stderr が Claude に戻る)
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0
command -v jq >/dev/null 2>&1 || exit 0

# 発火した証跡。hook の stdout は transcript に出ないので、「設定ミスで一度も
# 走っていない」と「走った上で素通り」を後から区別できない。空振りしている hook は
# 守られているつもりになるぶん無いより悪いので、1 行だけ残す (gitignore 済み)。
LOG=.claude/.hook-log
trace() { echo "$(date +%FT%T) check-frontend $1" >>"$LOG"; }

# .mjs を含めるのは scripts/measure-ui.mjs も vp check の対象だから。
PATTERNS=('*.ts' '*.tsx' '*.css' '*.mjs')
input="${HOOK_INPUT:-$(cat)}"

if [ "$(jq -r '.hook_event_name // empty' <<<"$input" 2>/dev/null)" = PreToolUse ]; then
  event=commit
  cmd="$(jq -r '.tool_input.command // empty' <<<"$input")"
  # if で絞っていても、Claude Code がコマンドを読み切れないときは何にでも呼ばれる。
  grep -Eq '(^|[[:space:];&|(])git[[:space:]]+commit([[:space:]]|$)' <<<"$cmd" || exit 0
  # commit に入る範囲。git add か -a を伴えば作業ツリー、伴わなければ index だけを見る。
  if grep -Eq '(^|[[:space:];&|(])git[[:space:]]+add([[:space:]]|$)|[[:space:]](--all|-[[:alpha:]]*a[[:alpha:]]*)([[:space:]]|$)' <<<"$cmd"; then
    changed="$(git status --porcelain -- "${PATTERNS[@]}" | wc -l)"
  else
    changed="$(git diff --cached --name-only -- "${PATTERNS[@]}" | wc -l)"
  fi
else
  event=stop
  # Stop hook 自身が Stop を誘発する無限ループを避ける。
  if [ "$(jq -r '.stop_hook_active // false' <<<"$input" 2>/dev/null)" = "true" ]; then
    trace "stop skip (stop_hook_active)"
    exit 0
  fi
  # 未追跡ファイルも見る。
  changed="$(git status --porcelain -- "${PATTERNS[@]}" | wc -l)"
fi

if [ "$changed" -eq 0 ]; then
  trace "$event skip (対象ファイルの変更なし)"
  exit 0
fi

# 同じ中身で一度通っていれば走らせない (会話だけのターンや、検査が通った直後の commit)。
# 鍵は HEAD と、HEAD からの差分 (index と作業ツリー) と、未追跡の対象ファイルの名前と中身。
key="$({
  git rev-parse HEAD
  git diff HEAD
  git ls-files -z --others --exclude-standard -- "${PATTERNS[@]}" |
    xargs -0 -r sh -c 'for f; do echo "$f"; cat -- "$f"; done' _
} 2>/dev/null | sha1sum | cut -c1-12)"
if grep -q "pass key=$key" "$LOG" 2>/dev/null; then
  trace "$event skip (検査済み key=$key)"
  exit 0
fi

if [ -f /.dockerenv ]; then
  run() { sh -c "$1"; }
else
  if [ -z "$(docker compose ps --status running --quiet dev 2>/dev/null)" ]; then
    trace "$event FAIL (コンテナ停止)"
    echo "format / lint / 型を検査できない。コンテナ (dev) が起動していない。docker compose up -d してからやり直す。" >&2
    exit 2
  fi
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
  trace "$event FAIL ($changed files)"
  {
    if [ "$event" = commit ]; then
      echo "commit 前の検査 (vp check / tsc) が落ちた。直してから commit する。"
    else
      echo "ターン終了前チェックが失敗した (vp check / tsc)。直してから終わること。"
    fi
    echo "$out" | tail -40
  } >&2
  exit 2
fi

trace "$event pass key=$key ($changed files)"
exit 0
