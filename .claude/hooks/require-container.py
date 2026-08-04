#!/usr/bin/env python3
"""PreToolUse hook — ホストで pnpm / npx / vp / tsc などを直に叩くのを止める。

ADR-008 は「開発は egress 制限つき Docker サンドボックス内」を前提にしているが、
Claude Code のセッションはホスト側で起動されることがある。その状態で pnpm を叩くと:

  - node_modules はコンテナ側の node/store で入っているのでホストの pnpm が
    purge しにかかり、ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY で止まる
  - Playwright を使うスクリプト (scripts/measure-ui.mjs 等) は chromium が
    イメージ焼き込みなのでホストには存在せず、そもそも起動できない

memory に書いても「思い出せなければ踏む」ので、ここで確定的に止める。

止めるのは *コマンド位置* にある該当バイナリだけ。`docker compose exec -T dev pnpm ...`
のように別のコマンドの引数として現れる分には通す。

exit 2 で stderr が Claude に返る (= 書き換えて再実行させる)。
"""

import json
import os
import re
import shlex
import sys

# コンテナ内でしか正しく動かないもの。basename で判定する。
CONTAINER_ONLY = {
    "pnpm",
    "npm",
    "npx",
    "yarn",
    "vp",
    "vite",
    "tsc",
    "vitest",
    "playwright",
    "wrangler",
    "drizzle-kit",
}

# セグメント区切り。パイプや && の後ろもコマンド位置になる。
# 改行は shlex が空白として食ってしまうので、行単位で回して別に扱う。
SEPARATORS = {"&&", "||", "|", ";", "&"}

# <<EOF / <<'EOF' / <<-EOF。`<<<` (herestring) は次のグループが英字始まりでないので
# マッチしない。
HEREDOC = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")


def strip_heredocs(command: str) -> str:
    """heredoc の本文を落とす。

    本文はシェルのトークンではなくただのテキストなので、そのまま shlex に渡すと
    commit メッセージや設定ファイルの中身をコマンドとして誤検知する。この hook 自身の
    導入 commit が `ブロック: cd && pnpm` という説明文で弾かれて気づいた。
    """
    lines = command.split("\n")
    kept: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        kept.append(line)
        tags = [m.group(2) for m in HEREDOC.finditer(line)]
        i += 1
        for tag in tags:
            while i < len(lines) and lines[i].strip() != tag:
                i += 1
            i += 1  # 終端行そのものも飛ばす
    return "\n".join(kept)


def command_heads(command: str) -> list[str]:
    """各コマンド位置の先頭トークンを返す。env 代入 (FOO=bar cmd) は読み飛ばす。

    行単位で回すのは、改行も && と同じくコマンド位置を作るのに shlex が空白として
    食ってしまうため (heredoc の終端直後のコマンドを取りこぼしていた)。
    引用符が行をまたぐと ValueError になるが、その行は諦めて通す (fail-open)。
    """
    heads: list[str] = []
    for line in strip_heredocs(command).split("\n"):
        try:
            tokens = shlex.split(line, comments=True)
        except ValueError:
            continue
        at_head = True
        for token in tokens:
            if token in SEPARATORS:
                at_head = True
                continue
            if not at_head:
                continue
            if "=" in token and token.split("=", 1)[0].isidentifier():
                continue  # FOO=bar のような前置き
            heads.append(os.path.basename(token))
            at_head = False
    return heads


def main() -> int:
    if os.path.exists("/.dockerenv"):
        return 0  # コンテナ内。そのまま実行してよい

    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0

    if payload.get("tool_name") != "Bash":
        return 0

    command = payload.get("tool_input", {}).get("command", "")
    offenders = [h for h in command_heads(command) if h in CONTAINER_ONLY]
    if not offenders:
        return 0

    name = offenders[0]
    print(
        f"`{name}` をホストで直接実行しようとしている。ここはコンテナ外 "
        f"(/.dockerenv 無し) なので動かない:\n"
        f"  - pnpm はコンテナ側で入れた node_modules を purge しにかかる "
        f"(ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY)\n"
        f"  - Playwright を使うスクリプトは chromium がイメージ焼き込みなので"
        f"ホストに無い\n"
        f"\n"
        f"コンテナ経由で叩き直すこと (ADR-008):\n"
        f"  docker compose exec -T dev <同じコマンド>\n"
        f"\n"
        f"dev サーバーの URL はコンテナ内なら既定の 5173。"
        f"ホストのブラウザから見る時だけ 5473。",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
