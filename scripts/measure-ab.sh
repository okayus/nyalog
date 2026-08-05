#!/usr/bin/env bash
# 作業ツリーの変更を stash して before を撮り、戻して after を撮り、diff を出す。
#
#   scripts/measure-ab.sh --marker contain-intrinsic-size            # 両方
#   scripts/measure-ab.sh --marker 'limit: PAGE_SIZE' --perf         # フェッチ / 描画量だけ
#   scripts/measure-ab.sh --marker foo --ui --views toilet,today     # 見た目 / a11y だけ
#
# measure-ui.mjs と measure-perf.mjs を dev サーバー相手に 2 回ずつ走らせる。
# 手で stash して撮るとハマる 2 点をここに閉じ込めてある:
#
#   1. **stash の取りこぼし。** 途中で失敗すると作業ツリーが stash に入ったまま残る。
#      気づかずに commit すると変更が半分消える。trap で必ず戻す。
#   2. **Vite HMR の遅れ。** stash 直後は dev サーバーがまだ変更後のコードを配っている。
#      待たずに撮ると before に after が混ざる (実際に混ざって、計画 3 で
#      LayoutObjects が run ごとに 875 / 603 / 609 と暴れた)。dev サーバーが実際に
#      配っている中身に --marker が出入りするのをポーリングして待つ。
#
# --marker は「変更後にだけ現れる文字列」。差分に固有のものを選ぶこと。変更前から
# 存在する文字列を渡すと 1 の待ちが永久に成立しない (計画 3 で content-visibility を
# 渡して踏んだ — 既存の ::details-content の transition に入っていた)。
#
# 前提は measure-ui.mjs / measure-perf.mjs と同じ (dev サーバー起動済み /
# DEV_BYPASS_USER_ID / 計測中は dev データを変えない = e2e を回さない)。
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 1

MARKER=""
MARKER_URL="/src/index.css"
RUN_UI=""
RUN_PERF=""
VIEWS=""
TIMEOUT=60

usage() {
  sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --marker) MARKER="$2"; shift 2 ;;
    --marker-url) MARKER_URL="$2"; shift 2 ;;
    --ui) RUN_UI=1; shift ;;
    --perf) RUN_PERF=1; shift ;;
    --views) VIEWS="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    -h|--help) usage 0 ;;
    *) echo "unknown option: $1" >&2; usage 2 ;;
  esac
done

[ -n "$MARKER" ] || { echo "--marker は必須" >&2; usage 2; }
# 既定は両方。片方だけ指定されたらそちらだけ。
if [ -z "$RUN_UI" ] && [ -z "$RUN_PERF" ]; then RUN_UI=1; RUN_PERF=1; fi

if [ -f /.dockerenv ]; then
  URL="http://localhost:5173"
  run() { sh -c "cd packages/web && $1"; }
else
  URL="http://localhost:5473"
  run() { docker compose exec -T dev sh -c "cd packages/web && $1"; }
fi

served() { curl -s --max-time 5 "${URL}${MARKER_URL}"; }
count_marker() { served | grep -c -- "$MARKER" 2>/dev/null || true; }

# 待つ前に、そもそも dev サーバーが生きていて marker が今は見えることを確かめる。
if [ -z "$(served)" ]; then
  echo "dev サーバー ($URL$MARKER_URL) から何も返らない。pnpm dev を起動する" >&2
  exit 1
fi
if [ "$(count_marker)" -eq 0 ]; then
  echo "目印 '$MARKER' が今の $MARKER_URL に見つからない。" >&2
  echo "変更後にだけ現れる文字列を選ぶこと (別ファイルなら --marker-url も指定する)。" >&2
  exit 1
fi

wait_marker() { # $1 = present | absent
  local want="$1" n i=0
  while [ "$i" -lt "$((TIMEOUT * 2))" ]; do
    n="$(count_marker)"
    [ "$want" = present ] && [ "$n" -ge 1 ] && return 0
    [ "$want" = absent ] && [ "$n" -eq 0 ] && return 0
    # 前景 sleep を使わずに 0.5 秒待つ
    perl -e 'select undef, undef, undef, 0.5' 2>/dev/null || sleep 1
    i=$((i + 1))
  done
  return 1
}

STASHED=""
restore() {
  if [ -n "$STASHED" ]; then
    git stash pop -q && STASHED=""
    echo "作業ツリーを戻した" >&2
  fi
}
trap restore EXIT INT TERM

VIEW_ARG=""
[ -n "$VIEWS" ] && VIEW_ARG="--views $VIEWS"

measure() { # $1 = before | after
  [ -n "$RUN_UI" ] && for theme in light dark; do
    run "node scripts/measure-ui.mjs --theme $theme $VIEW_ARG --out /tmp/ui-$1-$theme.json" >/dev/null
  done
  [ -n "$RUN_PERF" ] && run "node scripts/measure-perf.mjs $VIEW_ARG --out /tmp/perf-$1.json" >/dev/null
  return 0
}

if git diff --quiet HEAD -- packages/web; then
  echo "packages/web に未 commit の変更が無い。撮り比べる差分がない" >&2
  exit 1
fi

echo "== stash して before を撮る =="
git stash push -q -m "measure-ab" -- packages/web || { echo "stash に失敗" >&2; exit 1; }
STASHED=1
if ! wait_marker absent; then
  echo "" >&2
  echo "stash したのに目印 '$MARKER' が $MARKER_URL から消えない (${TIMEOUT}s)。" >&2
  echo "変更前から存在する文字列を目印にしている可能性が高い。差分に固有の文字列へ変えること。" >&2
  exit 1
fi
measure before

echo "== 戻して after を撮る =="
restore
if ! wait_marker present; then
  echo "戻したのに目印 '$MARKER' が $MARKER_URL に現れない (${TIMEOUT}s)" >&2
  exit 1
fi
measure after

if [ -n "$RUN_PERF" ]; then
  echo ""
  echo "## フェッチ / 描画量"
  run "node scripts/measure-perf.mjs --diff /tmp/perf-before.json /tmp/perf-after.json"
fi
if [ -n "$RUN_UI" ]; then
  for theme in light dark; do
    echo ""
    echo "## 見た目 / a11y ($theme)"
    run "node scripts/measure-ui.mjs --diff /tmp/ui-before-$theme.json /tmp/ui-after-$theme.json"
  done
fi
