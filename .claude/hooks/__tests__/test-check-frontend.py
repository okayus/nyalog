#!/usr/bin/env python3
"""check-frontend.sh の判定表。`python3 .claude/hooks/__tests__/test-check-frontend.py` で実行。

一時ディレクトリの git リポジトリに vp / tsc の代役 (シェルスクリプト) を置き、ホストでは
docker の代役も PATH の先頭に置く。本物の vp / tsc と npm パッケージは使わない。CI は回さない。
"""

import json
import os
import subprocess
import sys
import tempfile

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "check-frontend.sh")
IN_CONTAINER = os.path.exists("/.dockerenv")

BLOCK = 2
PASS = 0

# 代役の vp / tsc。STUB_FAIL=1 なら落ちる。呼ばれた回数を calls に足す。
STUB = """#!/bin/sh
echo x >> "$STUB_CALLS"
[ "${STUB_FAIL:-0}" = 1 ] && { echo "stub: error TS2322" >&2; exit 1; }
exit 0
"""

# 代役の docker。`compose ps` は FAKE_DOCKER_DOWN=1 なら何も返さない。`compose exec -T dev sh -c X` は X を手元で実行する。
DOCKER = """#!/bin/sh
case "$2" in
  ps) [ "${FAKE_DOCKER_DOWN:-0}" = 1 ] || echo fake-id ;;
  exec) shift 4; exec "$@" ;;
esac
"""


def write(path: str, text: str, mode: int = 0o644) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    os.chmod(path, mode)


def main() -> int:
    failed = 0
    total = 0
    with tempfile.TemporaryDirectory() as root:
        repo = os.path.join(root, "repo")
        bindir = os.path.join(root, "bin")
        calls = os.path.join(root, "calls")
        env = {
            **os.environ,
            "PATH": f"{bindir}:{os.environ['PATH']}",
            "CLAUDE_PROJECT_DIR": repo,
            "STUB_CALLS": calls,
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "t",
            "GIT_AUTHOR_EMAIL": "t@example.com",
            "GIT_COMMITTER_NAME": "t",
            "GIT_COMMITTER_EMAIL": "t@example.com",
        }
        env.pop("HOOK_INPUT", None)
        write(os.path.join(bindir, "docker"), DOCKER, 0o755)
        for tool in ("vp", "tsc"):
            write(os.path.join(repo, "packages/web/node_modules/.bin", tool), STUB, 0o755)
        write(os.path.join(repo, ".gitignore"), "node_modules/\n.claude/.hook-log\n")
        os.makedirs(os.path.join(repo, ".claude"))  # 証跡 .claude/.hook-log の置き場
        write(os.path.join(repo, "packages/web/src/a.ts"), "export const a = 1;\n")
        write(os.path.join(repo, "README.md"), "x\n")
        git = lambda *a: subprocess.run(["git", *a], cwd=repo, env=env, check=True, capture_output=True)
        git("init", "-q", "-b", "main")
        git("add", "-A")
        git("commit", "-q", "-m", "init")

        def run(name: str, expected: int, payload: dict, extra: dict | None = None, ran: bool | None = None) -> None:
            nonlocal failed, total
            before = os.path.getsize(calls) if os.path.exists(calls) else 0
            proc = subprocess.run(
                ["bash", HOOK], input=json.dumps(payload), capture_output=True, text=True,
                env={**env, **(extra or {})},
            )
            after = os.path.getsize(calls) if os.path.exists(calls) else 0
            ok = proc.returncode == expected and (ran is None or ran == (after > before))
            total += 1
            failed += not ok
            note = "" if ran is None else f" ran={after > before}"
            print(f"{'ok  ' if ok else 'FAIL'} {name} (expected={expected} actual={proc.returncode}{note})")
            if not ok and proc.stderr:
                print("     " + proc.stderr.strip().replace("\n", "\n     "))

        commit = lambda c: {"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": c}}
        stop = lambda active=False: {"hook_event_name": "Stop", "stop_hook_active": active}
        edit = lambda text: write(os.path.join(repo, "packages/web/src/a.ts"), text)

        run("commit ではない", PASS, commit("git status"), ran=False)
        edit("export const a = 2;\n")
        run("index に対象が無い commit", PASS, commit('git commit -m "docs: x"'), ran=False)
        run("git add と同じ行の commit は作業ツリーを見る", PASS, commit('git add -A && git commit -m "feat: a"'), ran=True)
        run("同じ中身は検査済み (commit)", PASS, commit('git commit -am "feat: a"'), ran=False)
        run("同じ中身は検査済み (Stop)", PASS, stop(), ran=False)
        edit("export const a = 3;\n")
        run("落ちたら commit を止める", BLOCK, commit('git commit -am "feat: a"'), {"STUB_FAIL": "1"}, ran=True)
        run("落ちたら Stop を止める", BLOCK, stop(), {"STUB_FAIL": "1"}, ran=True)
        run("stop_hook_active なら止めない", PASS, stop(active=True), {"STUB_FAIL": "1"}, ran=False)
        git("add", "-A")
        run("index にある対象は git add なしでも見る", PASS, commit('git commit -m "feat: a"'), ran=True)
        git("commit", "-q", "-m", "feat: a")
        write(os.path.join(repo, "README.md"), "y\n")
        run("docs だけの変更", PASS, commit('git add -A && git commit -m "docs: y"'), ran=False)
        if not IN_CONTAINER:
            edit("export const a = 4;\n")
            run("コンテナが止まっていれば理由を返して止める", BLOCK, commit("git commit -am x"), {"FAKE_DOCKER_DOWN": "1"}, ran=False)

    print(f"\n{total - failed}/{total} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
