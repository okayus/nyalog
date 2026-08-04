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
    # --- 通すべきもの ---
    (PASS, "docker compose exec 経由", "docker compose exec -T dev pnpm --filter @nyalog/web build"),
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
        [sys.executable, HOOK], input=payload, capture_output=True, text=True
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
    rc = subprocess.run([sys.executable, HOOK], input=payload, capture_output=True, text=True).returncode
    ok = rc == 0
    failed += not ok
    print(f"{'ok  ' if ok else 'FAIL'} Bash 以外のツール (expected=0 actual={rc})")

    print(f"\n{len(CASES) + 1 - failed}/{len(CASES) + 1} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
