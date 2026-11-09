#!/usr/bin/env python3
"""PreToolUse hook — migration を含むブランチで `Relay-Merge` を付けた commit を止める。

ホストのリレー (~/.config/nyalog-relay/relay.mjs) は、claude/* ブランチの HEAD commit に
`Relay-Merge: yes` があれば、CI が通った時点で squash merge する。merge すると Workers Builds の
deploy command が本番 D1 に migration を当てる。親テーブルの table rebuild で子の行が消えた
前歴がある (ADR-005 Addendum) ので、migration を含む PR は持ち主が merge する。

origin/main からの差分・index・作業ツリーのどこかに packages/web/drizzle/ があれば exit 2 で
止める。トレーラーの有無は、コマンド文字列 (heredoc の本文を含む)、-F で渡したファイル、
--amend や -C で使い回す既存の commit message から判定する。見る形は `Relay-Merge: yes` と
`--trailer Relay-Merge=yes` で、大文字小文字は区別しない (リレーより広く拾う側に倒す)。
本文で「Relay-Merge を付けない」と触れるだけなら止めない。origin/main を引けないときも止める。

settings.json の `if: Bash(git commit *)` で git commit のときだけ呼ばれるが、Claude Code が
コマンドを読み切れないときは何にでも呼ばれるので、ここでも git commit を探す。
"""

import json
import os
import re
import shlex
import subprocess
import sys

MIGRATIONS = "packages/web/drizzle/"
TRAILER = re.compile(r"relay-merge\s*[:=]\s*yes", re.IGNORECASE)
# `git [-C dir] [-c k=v] [--opt] commit <引数>`。引数は区切り記号か改行まで
COMMIT = re.compile(r"(?:^|[\s;&|(])git(?:\s+-[Cc]\s+\S+|\s+--\S+)*\s+commit\b([^\n;&|]*)")
MESSAGE_FILE = {"-F", "--file", "-t", "--template"}
REUSE = {"-C", "-c", "--reuse-message", "--reedit-message"}
MESSAGE = {"-m", "--message"}


def git(top: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", top, *args], capture_output=True, text=True)


def read_text(path: str, cwd: str) -> str:
    try:
        with open(os.path.join(cwd, path), encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def carries_trailer(command: str, commit_args: list[str], cwd: str, top: str) -> bool:
    if TRAILER.search(command):
        return True
    for args in commit_args:
        try:
            tokens = shlex.split(args)
        except ValueError:
            tokens = args.split()
        files: list[str] = []
        reuse: list[str] = []
        has_message = False
        for i, token in enumerate(tokens):
            value = tokens[i + 1] if i + 1 < len(tokens) else ""
            name, eq, attached = token.partition("=")
            if token in MESSAGE_FILE:
                files.append(value)
            elif eq and name in MESSAGE_FILE:
                files.append(attached)
            elif token.startswith("-F") and len(token) > 2:
                files.append(token[2:])
            elif token in REUSE:
                reuse.append(value)
            elif eq and name in REUSE:
                reuse.append(attached)
            elif token in MESSAGE or (eq and name in MESSAGE) or token.startswith("-m"):
                has_message = True
        if any(TRAILER.search(read_text(f, cwd)) for f in files if f and f != "-"):
            return True
        if "--amend" in tokens and not (has_message or files or reuse):
            reuse.append("HEAD")
        for ref in reuse:
            if ref and TRAILER.search(git(top, "log", "-1", "--format=%B", ref, "--").stdout):
                return True
    return False


def changed_files(top: str) -> set[str]:
    files: set[str] = set()
    for args in (
        ("diff", "--name-only", "-z", "origin/main...HEAD"),
        ("diff", "--name-only", "-z", "--cached"),
        ("diff", "--name-only", "-z"),
        ("ls-files", "-z", "--others", "--exclude-standard"),
    ):
        files.update(p for p in git(top, *args).stdout.split("\0") if p)
    return files


def deny(message: str) -> int:
    print(f"guard-relay-merge: {message}", file=sys.stderr)
    return 2


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        return 0
    if payload.get("tool_name") != "Bash":
        return 0
    command = (payload.get("tool_input") or {}).get("command") or ""
    commit_args = [m.group(1) for m in COMMIT.finditer(command)]
    if not commit_args:
        return 0

    cwd = payload.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    toplevel = subprocess.run(
        ["git", "-C", cwd, "rev-parse", "--show-toplevel"], capture_output=True, text=True
    )
    if toplevel.returncode != 0:
        return 0
    top = toplevel.stdout.strip()

    if not carries_trailer(command, commit_args, cwd, top):
        return 0
    if git(top, "rev-parse", "--verify", "--quiet", "origin/main").returncode != 0:
        return deny(
            "origin/main を引けないので、このブランチが migration を含むか確かめられない。"
            "git fetch origin してからやり直す。"
        )
    hits = sorted(p for p in changed_files(top) if p.startswith(MIGRATIONS))
    if not hits:
        return 0
    shown = ", ".join(hits[:3]) + (f" ほか {len(hits) - 3} 件" if len(hits) > 3 else "")
    return deny(
        f"このブランチには migration の変更がある ({shown})。Relay-Merge を付けた commit は作らない。"
        "merge すると Workers Builds が本番 D1 に migration を当てる (ADR-005 Addendum)。"
        "トレーラーを外して commit し、merge は持ち主に頼む。"
    )


if __name__ == "__main__":
    sys.exit(main())
