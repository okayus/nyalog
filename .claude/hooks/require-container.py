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
のように別のコマンドの引数として現れる分には通す。`timeout 600 pnpm install` のように
引数をコマンドとして実行するラッパーは剥がしてから見る。Claude Code の permission 照合も
timeout / time / nice などを剥がしてから allow ルールに当てるので、ここで剥がさないと
hook を素通りした上で allow に当たる。

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
    "pnpx",
    "npm",
    "npx",
    "yarn",
    "corepack",
    "vp",
    "vite",
    "tsc",
    "tsx",
    "vitest",
    "playwright",
    "wrangler",
    "drizzle-kit",
}

# セグメント区切り。パイプや && の後ろもコマンド位置になる。`(` と `{` の後ろも同じ。
# 改行は shlex が空白として食ってしまうので、行単位で回して別に扱う。
SEPARATORS = {"&&", "||", "|", "|&", ";", ";;", "&", "(", "{"}

# コマンド位置に来ても、その次の語がコマンドになるシェルの予約語。
KEYWORDS = {"!", "if", "then", "else", "elif", "while", "until", "do"}

# 後ろの引数をコマンドとして実行するラッパー。
# 値: (値を次の語で取るオプション, コマンドの前に来る位置引数の数)
WRAPPERS = {
    "timeout": ({"-k", "--kill-after", "-s", "--signal"}, 1),
    "time": ({"-f", "--format", "-o", "--output"}, 0),
    "nice": ({"-n", "--adjustment"}, 0),
    "nohup": (set(), 0),
    "stdbuf": ({"-i", "-o", "-e", "--input", "--output", "--error"}, 0),
    "command": (set(), 0),
    "builtin": (set(), 0),
    "noglob": (set(), 0),
    "exec": ({"-a"}, 0),
    "env": ({"-u", "--unset", "-C", "--chdir", "-S", "--split-string"}, 0),
    "xargs": (
        {"-a", "--arg-file", "-d", "--delimiter", "-E", "-I", "-L", "--max-lines",
         "-n", "--max-args", "-P", "--max-procs", "-s", "--max-chars"},
        0,
    ),
    "sudo": ({"-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt",
              "-C", "--close-from", "-D", "--chdir", "-r", "--role", "-t", "--type",
              "-T", "--command-timeout", "-U", "--other-user"}, 0),
}

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


def tokenize(line: str) -> list[str]:
    """`cd x&&pnpm` の `&&` や `$(pnpm` の `(` も独立した語にして分ける。"""
    lexer = shlex.shlex(line, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    return list(lexer)


def is_separator(token: str) -> bool:
    if token in SEPARATORS:
        return True
    # `)&&` のように記号が続くと 1 語になる。`>&` `&>` はリダイレクトなので区切りにしない
    if token and all(c in "();<>|&" for c in token):
        return any(s in token for s in ("(", ";", "|", "&&")) or (
            token.endswith("&") and not token.endswith(">&")
        )
    return False


def is_assignment(token: str) -> bool:
    return "=" in token and token.split("=", 1)[0].isidentifier()


def command_heads(command: str) -> list[str]:
    """各コマンド位置の先頭トークンを返す。env 代入 (FOO=bar cmd) とラッパーは読み飛ばす。

    行単位で回すのは、改行も && と同じくコマンド位置を作るのに shlex が空白として
    食ってしまうため (heredoc の終端直後のコマンドを取りこぼしていた)。
    引用符が行をまたぐと ValueError になるが、その行は諦めて通す (fail-open)。
    """
    heads: list[str] = []
    joined = strip_heredocs(command).replace("\\\n", " ")
    for line in joined.split("\n"):
        try:
            tokens = tokenize(line)
        except ValueError:
            continue
        at_head = True
        wrapper = None  # 剥がしている途中のラッパー
        skip_value = False  # 直前のオプションが値を取る
        positional = 0  # ラッパーの位置引数 (timeout の秒数) の残り
        for token in tokens:
            if is_separator(token):
                at_head, wrapper, skip_value = True, None, False
                continue
            if not at_head:
                continue
            if wrapper is not None:
                options, _ = WRAPPERS[wrapper]
                if skip_value:
                    skip_value = False
                    continue
                if token.startswith("-") and token != "-":
                    if wrapper == "command" and token in ("-v", "-V"):
                        at_head, wrapper = False, None  # 探すだけで実行しない
                        continue
                    skip_value = token in options  # --opt=値 や -n10 は値込み
                    continue
                if wrapper == "env" and is_assignment(token):
                    continue
                if positional > 0:
                    positional -= 1
                    continue
                wrapper = None
            if token in KEYWORDS or is_assignment(token):
                continue
            name = os.path.basename(token)
            if name in WRAPPERS:
                wrapper, positional = name, WRAPPERS[name][1]
                continue
            heads.append(name)
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
        f"pnpm が PATH に無いと言われたら .bin を直に叩く:\n"
        f"  docker compose exec -T dev sh -c 'cd packages/web && ./node_modules/.bin/vp check'\n"
        f"\n"
        f"dev サーバーの URL はコンテナ内なら既定の 5173。"
        f"ホストのブラウザから見る時だけ 5473。",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
