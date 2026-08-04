#!/usr/bin/env bash
# main へ merge した後、本番に自分のビルドが載ったかを確認する。
#
# **GitHub からは見えない。** Workers Builds は commit status を出さないので
# `commits/<sha>/status` は statuses: [] のまま (CLAUDE.md)。本番 HTML が参照する
# /assets/index-*.{css,js} のハッシュを、ローカルビルドの
# packages/web/dist/client/assets/ と照合するのが唯一の確認手段。
#
#   scripts/deploy-status.sh            # 1 回照合
#   scripts/deploy-status.sh --build    # 先にコンテナでビルドしてから照合
#   scripts/deploy-status.sh --watch    # 一致するまで 45 秒ごとに引き直す
#
# 終了コード:
#   0  一致 (deploy 完了)
#   1  本番は見えるがハッシュが違う (まだ前のビルド、または別 commit が載っている)
#   2  ローカルビルドが無い / 本番に届かない
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 2

SITE="${NYALOG_SITE:-https://nyalog.shiraoka.workers.dev}"
DIST="packages/web/dist/client/assets"

watch=0
build=0
for a in "$@"; do
  case "$a" in
    --watch) watch=1 ;;
    --build) build=1 ;;
    -h | --help)
      sed -n '2,17p' "$0"
      exit 0
      ;;
    *)
      echo "unknown option: $a" >&2
      exit 64
      ;;
  esac
done

if [ "$build" -eq 1 ]; then
  # ホストでは走らない (chromium 同様 node_modules がコンテナ側 — ADR-008)。
  echo "--- ローカルビルド ---"
  if [ -f /.dockerenv ]; then
    (cd packages/web && ./node_modules/.bin/vp build) >/dev/null || exit 2
  else
    docker compose exec -T dev sh -c 'cd packages/web && ./node_modules/.bin/vp build' >/dev/null || exit 2
  fi
fi

if [ ! -d "$DIST" ]; then
  echo "$DIST が無い。--build を付けるか、先に vp build すること" >&2
  exit 2
fi

# ローカル成果物のファイル名 (= 内容ハッシュ) を並べる。
local_assets="$(cd "$DIST" && ls index-*.css index-*.js 2>/dev/null | LC_ALL=C sort | tr '\n' ' ')"
if [ -z "$local_assets" ]; then
  echo "$DIST に index-*.css / index-*.js が無い" >&2
  exit 2
fi

poll() {
  local html prod
  html="$(curl -s --max-time 20 "$SITE/")" || true
  if [ -z "$html" ]; then
    echo "本番に届かない: $SITE"
    return 2
  fi
  prod="$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.(css|js)' <<<"$html" | sed 's|/assets/||' | LC_ALL=C sort | tr '\n' ' ')"
  if [ -z "$prod" ]; then
    echo "本番 HTML に /assets/index-* の参照が無い (SPA シェルが返っていない?)"
    return 2
  fi
  if [ "$prod" = "$local_assets" ]; then
    echo "一致: $prod"
    return 0
  fi
  echo "不一致"
  echo "  local: $local_assets"
  echo "  prod : $prod"
  return 1
}

while :; do
  rc=0
  poll || rc=$?
  if [ "$watch" -eq 0 ] || [ "$rc" -eq 0 ]; then
    exit "$rc"
  fi
  echo "--- $(date +%H:%M:%S) 未反映。45 秒後に再取得 ---"
  sleep 45
done
