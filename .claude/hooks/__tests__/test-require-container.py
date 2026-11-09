#!/usr/bin/env python3
"""require-container.py の判定表。`python3 .claude/hooks/__tests__/test-require-container.py` で実行。

コンテナ内 (/.dockerenv あり) では hook が無条件に素通しになるので、
このテストはホストでのみ意味を持つ。CI は回さない。
"""

import json
import os
import subprocess
import sys

HOOK = os.path.join(os.path.dirname(__file__), "..", "require-container.py")

BLOCK = 2
PASS = 0

CASES: list[tuple[int, str, str]] = [
    # --- 素の実行は止める ---
    (BLOCK, "pnpm 素", "pnpm --filter @nyalog/web build"),
    (BLOCK, "cd してから pnpm", "cd packages/web && pnpm test"),
    (BLOCK, "node_modules/.bin 直叩き", "./node_modules/.bin/vp check"),
    (BLOCK, "env 前置き + npx", "NODE_ENV=test npx -y modern-web-guidance@latest list"),
    (BLOCK, "パイプの先の tsc", "echo x | tsc --noEmit"),
    (BLOCK, "wrangler", "wrangler d1 execute nyalog-db --local"),
    (BLOCK, "herestring の後の pnpm", 'jq -r .x <<<"$json" && pnpm build'),
    # heredoc の *終端後* は本物のコマンド位置
    (BLOCK, "heredoc の後の pnpm", "cat <<EOF\nharmless\nEOF\npnpm build"),
    # ラッパーは剥がす。permission の照合も剥がすので、素通りすると allow に当たる
    (BLOCK, "timeout で包んだ pnpm", "timeout 600 pnpm install"),
    (BLOCK, "timeout のオプション付き", "timeout -s KILL 60 vitest run"),
    (BLOCK, "time", "time pnpm build"),
    (BLOCK, "nice -n", "nice -n 10 pnpm test"),
    (BLOCK, "env 経由", "env NODE_ENV=test pnpm test"),
    (BLOCK, "command 経由", "command pnpm build"),
    (BLOCK, "xargs -n1", "ls | xargs -n1 tsc --noEmit -p"),
    (BLOCK, "語に付いた &&", "cd packages/web&&pnpm build"),
    (BLOCK, "$() の中", "echo $(pnpm --version)"),
    (BLOCK, "サブシェル", "(cd packages/web && pnpm build)"),
    (BLOCK, "プロセス置換", "diff <(pnpm list) expected.txt"),
    (BLOCK, "if の中", "if true; then pnpm build; fi"),
    (BLOCK, "行の継続", "pnpm \\\n  build"),
    (BLOCK, "corepack", "corepack pnpm install"),
    (BLOCK, "tsx", "tsx scripts/seed.ts"),
    # --- 通すべきもの ---
    (PASS, "docker compose exec 経由", "docker compose exec -T dev pnpm --filter @nyalog/web build"),
    (PASS, "docker compose exec で .bin 直叩き", "docker compose exec -T dev sh -c 'cd packages/web && ./node_modules/.bin/vp check'"),
    (PASS, "command -v は探すだけ", "command -v pnpm"),
    (PASS, "timeout で包んだ自前スクリプト", "timeout 900 ./scripts/deploy-status.sh --build --watch"),
    (PASS, "node はホストの道具にも使う", "node ~/.config/d1-backup/d1-bookmark.mjs nyalog 87"),
    (PASS, "リダイレクトとパイプ", "git log --oneline 2>&1 | head -5"),
    (PASS, "引用符の中の括弧", "grep -E '(pnpm|npx)' CLAUDE.md"),
    (PASS, "文字列として言及", 'git commit -m "chore: pnpm install を直す"'),
    (PASS, "grep の引数", "grep -rn pnpm CLAUDE.md"),
    (PASS, "自前スクリプト", "./scripts/ci-status.sh --watch"),
    (PASS, "herestring 単体", 'jq -r .x <<<"$json"'),
    # heredoc 本文はテキストであってコマンドではない。この hook の導入 commit が
    # 説明文 (`ブロック: cd && pnpm`) で自分に弾かれて気づいた。
    (PASS, "heredoc 本文の pnpm", "git commit -F - <<EOF\nブロック: cd && pnpm / npx\nEOF"),
    (PASS, "quoted heredoc 本文の tsc", "cat > f.md <<'EOF'\nnpx foo && tsc --noEmit\nEOF"),
    # 引用符が行をまたぐと解析できない。fail-open (便宜的なガードであって境界ではない)
    (PASS, "引用符が閉じていない", 'echo "unclosed'),
]


def run(command: str) -> int:
    payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}})
    return subprocess.run(
        [sys.executable, "-I", HOOK], input=payload, capture_output=True, text=True
    ).returncode


def main() -> int:
    if os.path.exists("/.dockerenv"):
        print("skip: コンテナ内では hook が無条件に素通しになる")
        return 0

    failed = 0
    for expected, name, command in CASES:
        actual = run(command)
        ok = actual == expected
        failed += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {name} (expected={expected} actual={actual})")

    # Bash 以外のツールには一切干渉しない
    payload = json.dumps({"tool_name": "Edit", "tool_input": {"command": "pnpm build"}})
    rc = subprocess.run([sys.executable, "-I", HOOK], input=payload, capture_output=True, text=True).returncode
    ok = rc == 0
    failed += not ok
    print(f"{'ok  ' if ok else 'FAIL'} Bash 以外のツール (expected=0 actual={rc})")

    print(f"\n{len(CASES) + 1 - failed}/{len(CASES) + 1} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
