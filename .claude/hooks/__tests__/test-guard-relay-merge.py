#!/usr/bin/env python3
"""guard-relay-merge.py の判定表。`python3 .claude/hooks/__tests__/test-guard-relay-merge.py` で実行。

一時ディレクトリに git リポジトリを作り、origin/main を refs/remotes に置いて試す。
ホストでもコンテナでも走る (標準ライブラリと git だけ)。CI は回さない。
"""

import json
import os
import subprocess
import sys
import tempfile

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "guard-relay-merge.py")

BLOCK = 2
PASS = 0

# 持ち主の ~/.gitconfig (署名など) を効かせない
ENV = {
    **os.environ,
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_AUTHOR_NAME": "t",
    "GIT_AUTHOR_EMAIL": "t@example.com",
    "GIT_COMMITTER_NAME": "t",
    "GIT_COMMITTER_EMAIL": "t@example.com",
}

EMPTY_MERGE = 'git commit --allow-empty -m "chore: マージを依頼する" -m "Relay-Merge: yes"'


def sh(cwd: str, *args: str) -> None:
    subprocess.run(args, cwd=cwd, env=ENV, check=True, capture_output=True)


def write(repo: str, path: str, text: str) -> None:
    full = os.path.join(repo, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(text)


def make_repo(root: str, name: str, *, origin: bool = True) -> str:
    repo = os.path.join(root, name)
    os.makedirs(repo)
    sh(repo, "git", "init", "-q", "-b", "main")
    write(repo, "README.md", "x\n")
    sh(repo, "git", "add", "-A")
    sh(repo, "git", "commit", "-q", "-m", "init")
    if origin:
        sh(repo, "git", "update-ref", "refs/remotes/origin/main", "HEAD")
    sh(repo, "git", "switch", "-q", "-c", f"claude/{name}")
    return repo


def run(repo: str, command: str, tool: str = "Bash") -> int:
    payload = json.dumps({"tool_name": tool, "tool_input": {"command": command}, "cwd": repo})
    return subprocess.run(
        [sys.executable, "-I", HOOK], input=payload, capture_output=True, text=True, env=ENV
    ).returncode


def main() -> int:
    with tempfile.TemporaryDirectory() as root:
        # migration を commit 済みのブランチ
        mig = make_repo(root, "migration")
        write(mig, "packages/web/drizzle/0013_x.sql", "CREATE TABLE x (id text);\n")
        sh(mig, "git", "add", "-A")
        sh(mig, "git", "commit", "-q", "-m", "feat: x")
        write(mig, "msg.txt", "chore: マージを依頼する\n\nRelay-Merge: yes\n")

        # migration を含まないブランチ
        plain = make_repo(root, "plain")
        write(plain, "packages/web/src/a.ts", "export {};\n")
        sh(plain, "git", "add", "-A")
        sh(plain, "git", "commit", "-q", "-m", "feat: a")

        # migration がまだ index にあるだけ / まだ作業ツリーにあるだけ
        staged = make_repo(root, "staged")
        write(staged, "packages/web/drizzle/0014_y.sql", "x\n")
        sh(staged, "git", "add", "-A")
        untracked = make_repo(root, "untracked")
        write(untracked, "packages/web/drizzle/0015_z.sql", "x\n")

        # HEAD の message にトレーラーが既にある (amend で使い回す)
        amended = make_repo(root, "amended")
        write(amended, "packages/web/drizzle/0016_w.sql", "x\n")
        sh(amended, "git", "add", "-A")
        sh(amended, "git", "commit", "-q", "-m", "feat: w", "-m", "Relay-Merge: yes")

        no_origin = make_repo(root, "no-origin", origin=False)
        not_repo = os.path.join(root, "not-a-repo")
        os.makedirs(not_repo)

        cases = [
            (BLOCK, "空 commit でトレーラー", mig, EMPTY_MERGE),
            (BLOCK, "heredoc の本文", mig, "git commit -F - <<'EOF'\nfeat: x\n\nRelay-Merge: yes\nEOF"),
            (BLOCK, "--trailer", mig, 'git commit --allow-empty -m "chore: m" --trailer "Relay-Merge: yes"'),
            (BLOCK, "--trailer の = 形", mig, 'git commit --allow-empty -m "chore: m" --trailer Relay-Merge=yes'),
            (BLOCK, "-F のファイル", mig, "git commit --allow-empty -F msg.txt"),
            (BLOCK, "小文字", mig, 'git commit --allow-empty -m "chore: m" -m "relay-merge: yes"'),
            (BLOCK, "git add と同じ行", untracked, f"git add -A && {EMPTY_MERGE}"),
            (BLOCK, "index にだけある migration", staged, EMPTY_MERGE),
            (BLOCK, "amend で HEAD の message を使い回す", amended, "git commit --amend --no-edit"),
            (BLOCK, "-C で別 commit の message を使い回す", amended, "git commit --allow-empty -C HEAD"),
            (BLOCK, "origin/main が無い", no_origin, EMPTY_MERGE),
            (PASS, "migration の無いブランチ", plain, EMPTY_MERGE),
            (PASS, "トレーラーの無い commit", mig, 'git commit --allow-empty -m "fix: y"'),
            (PASS, "本文で触れるだけ", mig, "git commit --allow-empty -F - <<'EOF'\ndocs: Relay-Merge の条件を書く\n\nmigration を含む PR には Relay-Merge を付けない。\nEOF"),
            (PASS, "amend でも message を書き直す", amended, 'git commit --amend -m "feat: w"'),
            (PASS, "commit ではない", mig, "grep -n Relay-Merge CLAUDE.md"),
            (PASS, "git の外", not_repo, EMPTY_MERGE),
        ]
        failed = 0
        for expected, name, repo, command in cases:
            actual = run(repo, command)
            ok = actual == expected
            failed += not ok
            print(f"{'ok  ' if ok else 'FAIL'} {name} (expected={expected} actual={actual})")

        rc = run(mig, EMPTY_MERGE, tool="Edit")
        ok = rc == PASS
        failed += not ok
        print(f"{'ok  ' if ok else 'FAIL'} Bash 以外のツール (expected=0 actual={rc})")

    total = len(cases) + 1
    print(f"\n{total - failed}/{total} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
