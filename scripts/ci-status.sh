#!/usr/bin/env bash
# HEAD の sha を固定して GitHub の check-runs と PR 番号を引く。
#
# branch 名で引くと、ホスト側リレー (60 秒 timer) が push する前の "古い sha" の結果が返る。
# CI 完了を待つループがそれを掴むと、前の commit の success で誤って抜ける。CLAUDE.md が
# 「追いコミット後は branch でなく sha で引く」と定めているのはこのため。sha 固定をここに焼いた。
#
#   scripts/ci-status.sh              # HEAD の check-runs を 1 回引く
#   scripts/ci-status.sh <sha|ref>    # 任意の commit
#   scripts/ci-status.sh --watch      # 決着が付くまで 30 秒ごとに引き直す
#
# public repo なので認証不要 (60 req/h)。サンドボックス内は gh が未認証で動かない (ADR-008)。
#
# 終了コード:
#   0  全部 success
#   1  failure / cancelled / timed_out あり
#   2  まだ pending、または push 前で commit が GitHub に無い
set -euo pipefail

REPO="${NYALOG_REPO:-okayus/nyalog}"
API="https://api.github.com/repos/$REPO"

watch=0
ref=""
for a in "$@"; do
  case "$a" in
    --watch) watch=1 ;;
    -h | --help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    -*)
      echo "unknown option: $a" >&2
      exit 64
      ;;
    *) ref="$a" ;;
  esac
done

sha="$(git rev-parse "${ref:-HEAD}")"
short="${sha:0:7}"

poll() {
  local json pulls bad pending
  json="$(curl -sf "$API/commits/$sha/check-runs" || true)"

  if [ -z "$json" ]; then
    echo "$short: GitHub に無い — まだ push されていない (リレーは 60 秒 timer)"
    return 2
  fi
  if [ "$(jq -r '.total_count' <<<"$json")" = "0" ]; then
    echo "$short: check-runs 0 件 — push 直後で CI が起動していない"
    return 2
  fi

  # PR 番号は「完了したら plans に ✅ (PR #nn)」で要る。merge 後はブランチが消えて
  # pulls?head= が空になるので、branch でなく commit 側から引く。
  pulls="$(curl -sf "$API/commits/$sha/pulls" || true)"
  if [ -n "$pulls" ]; then
    jq -r '.[] | "PR #\(.number) [\(.state)] \(.title)"' <<<"$pulls"
  fi

  echo "$short:"
  jq -r '.check_runs[]
    | "  \(.name): \(.status)\(if .conclusion then " / " + .conclusion else "" end)"' <<<"$json"

  bad="$(jq -r '[.check_runs[]
    | select(.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out")]
    | length' <<<"$json")"
  pending="$(jq -r '[.check_runs[] | select(.status != "completed")] | length' <<<"$json")"

  [ "$bad" -eq 0 ] || return 1
  [ "$pending" -eq 0 ] || return 2
  return 0
}

while :; do
  rc=0
  poll || rc=$?
  if [ "$watch" -eq 0 ] || [ "$rc" -ne 2 ]; then
    exit "$rc"
  fi
  echo "--- $(date +%H:%M:%S) 未決着。30 秒後に再取得 ---"
  sleep 30
done
