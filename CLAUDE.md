# nyalog

猫の健康管理 Web アプリ。家族数人が各自のスマホで使う。決定は `docs/adr/`、開発環境の手順と計測の道具は `docs/local-dev.md` にある。

@docs/status.md

## サンドボックスとリレー（ADR-008）

- 開発はコンテナ（compose のサービス `dev`）で行う。コンテナには資格情報が無く、通信は allowlist の外に出られない（`.docker/init-firewall.sh`）。`git push` は deny で、`gh` は未認証で動かない。
- push と PR はホストのリレーが行う。リレーは 60 秒ごとにこの作業コピーの `claude/*` ブランチを見て、新しい commit を push し、PR を作る。別の clone で commit しても push されない。ブランチは `claude/<type>-<desc>` で切り、commit までを行う。
- ホストで開いたセッションでも、編集と commit はそのまま行う。pnpm・npx・vp・tsc・vitest・playwright・wrangler はホストで走らせず、`docker compose exec -T dev sh -c 'cd packages/web && ./node_modules/.bin/vp check'` の形でコンテナに投げる。pnpm はイメージに無く、コンテナの起動時に入れる。見つからないときは `.bin` を直に叩くか、コンテナを起動し直す（e2e は中で pnpm を呼ぶ）。
- ホストの gh は持ち主の認証で動く。PR はリレーが作るので、`gh pr create` は打たない。
- dev サーバーはコンテナで `pnpm dev -- --host 0.0.0.0` と起動する。コンテナからは 5173、ホストのブラウザと Playwright MCP からは http://localhost:5473 で開く。
- 持ち主に頼むのは、資格情報が要る操作だけにする（`wrangler login` などのログイン、`wrangler secret put`、本番 D1 への SQL、手動デプロイ）。対話式の TUI や設定の変更は、設定ファイルや CLI のフラグで自分で済ませる。

## 確かめる

CI（`.github/workflows/check.yml`）と同じ検査を、コンテナのリポジトリ root で打つ。

```bash
pnpm --filter @nyalog/web exec vp check                              # format と lint（--fix で直す）
pnpm --filter @nyalog/web exec tsc --noEmit -p tsconfig.json         # フロント
pnpm --filter @nyalog/web exec tsc --noEmit -p tsconfig.worker.json  # Worker
pnpm build
pnpm --filter @nyalog/web test:e2e                                   # e2e（Playwright）
pnpm --filter @nyalog/web test                                       # 単体（vitest）。CI では走らない
```

- e2e はローカル dev の猫と記録を消す（`e2e/global-setup.ts`）。画面で確かめている途中なら、撮り終えてから回す。戻すには `pnpm --filter @nyalog/web exec wrangler d1 execute nyalog-db --local --file scripts/dev-seed.sql` を打つ。
- CI の結果は `scripts/ci-status.sh` で見る（`--watch` で決着まで待つ）。branch 名で引くと、リレーが push する前の古い sha の結果を掴む。未認証の REST は 1 時間に 60 回までなので、`--watch` を長く回さない。
- merge 後の本番反映は GitHub から見えない（Workers Builds は commit status を出さない）。`scripts/deploy-status.sh --build --watch` が、本番のアセットのハッシュをローカルビルドと照合する。作業ツリーをビルドするので、main を checkout してから打つ。
- 血液検査の解析は、dev と e2e では mock になる（`wrangler.local.jsonc`）。実モデルは本番デプロイの後にしか確かめられない。
- CSS・a11y・フェッチ量を変える PR の before/after は `scripts/measure-ab.sh` で撮る。commit する前に、dev サーバーを起動してから打つ。

## commit と merge

- commit の題は Conventional Commits で書く（`feat: …`。説明は日本語）。大きな節目では `docs/status.md` も更新する（同じ PR に含めてよい）。
- PR の題は、リレーが PR を作った時点の HEAD commit の題になり、squash 後の main の履歴にも残る。ふつうはブランチの最初の commit なので、本題の commit を最初に置く。
- push 済みの commit は amend しない。リレーは force push しないので、以後の push が拒否される。CI が落ちたら、直す commit を積む。
- merge は持ち主が決める。確信のある完成した変更に限り、HEAD の commit に `Relay-Merge: yes` トレーラーを付けてよい。CI が通るとリレーが squash merge する。トレーラーは HEAD にあるときだけ効くので、commit を積んだら出し直す。迷う変更と影響の大きい変更には付けない。
- 後から merge を頼まれたら、空 commit でトレーラーを出す: `git commit --allow-empty -m "chore: マージを依頼する" -m "Relay-Merge: yes"`。ホストのセッションなら、CI が通ったのを確かめて `gh pr merge <番号> --squash` を打ってもよい。
- migration（`packages/web/drizzle/`）を含む PR には Relay-Merge を付けない。merge すると、Workers Builds の deploy command が本番 D1 に migration を当てる。持ち主に頼まれたときだけ、ホストのセッションから `gh pr merge` で merge する。
- トレーラーを出した直後の tick は、CI が回り直すので `405 … Required status check "check" is expected` で空振りする。これは正常で、次の tick 以降に merge される。merge 後はブランチが消えるので、成否はホストの `journalctl --user -u nyalog-relay.service` か、`https://api.github.com/repos/okayus/nyalog/pulls/<番号>` の `merged` で見る。
- `.github/workflows/**` の変更はリレーが push できない（GitHub App に workflows 権限が無い）。持ち主に push を頼む。

## D1 migration

- migration は `pnpm db:generate` で作り、`pnpm db:migrate` でローカル D1 に当てる。
- D1 は `PRAGMA foreign_keys=OFF` を無視する。drizzle が親テーブル（`onDelete: "cascade"` で指される側）を table rebuild すると、`DROP TABLE` が子の行を連鎖削除する。ローカルの miniflare では起きない。
- table rebuild を含む migration は、ADR-005 Addendum の運用チェックリストに従う。merge の前に本番からの export と cascade FK の確認、merge の後に子テーブルの件数の照合を行う。`--remote` の操作は持ち主がホストで行う。

## 書き方

- ドメインは Zod、Branded Type（`{ readonly __brand: unique symbol }`）、neverthrow の Result で書く。副作用（D1・R2・HTTP）は routes などの境界に置き、ドメインは純粋関数にする。
- エラーは throw せずに Result で返す（Workflows の step は retry させるために throw する）。`any` は使わない。
- 認可の単位はスペース（ADR-005）。
  - スペースに属するデータは `c.var.memberSpaceIds` で絞る。`toilet_records` のように猫を経由して属するものは、猫を引く段階で `inArray(cats.spaceId, memberSpaceIds)` を効かせる。
  - 新規 INSERT の `space_id` は `memberSpaceIds[0]` にする（1 人が 1 スペースに属する前提）。空なら 403 を返す。
  - 所属外のスペースの資源（猫など）の id を指定されたら 404 を返す。403 は存在を漏らす。
  - `credentials` と `sessions` は `c.var.userId` で絞る。`created_by` は監査用で、認可には使わない（ADR-004）。
- HTML・CSS・クライアント JS を書く前に skill `modern-web-guidance` を読む。Baseline Newly available まで使ってよい。polyfill と重い fallback は入れず、未対応のブラウザでは機能が消えるだけで壊れない形にする（機能検出の例は `packages/web/src/view-transition.ts`）。`prefers-reduced-motion` を添える。

## テスト方針

- 単体テストはドメインの意味を固定する。対象は純粋関数、Zod スキーマ、Result の契約。IO を持ち込まず、モックもしない（IO のモックが要るなら、それは e2e で確かめる）。型で保証済みのことはテストにしない。
- e2e は配線と存在の事実だけを守る（クリティカルパス 1 本、リロード後の永続化、他スペースへの横流れ、セキュリティヘッダ）。ドメインの網羅は e2e でしない。

## Agent skills

- third-party skill は `.claude/skills/` に実体で置く。追加も更新も、コンテナで `npx -y skills@latest add <owner>/<repo> -y -s <skill> --copy` を打つ。`--copy` を付けないか `skills update` を使うと、gitignore 済みの `.agents/` への symlink になり、clone 先で壊れる。
- skill の更新は単独の PR にする。`skills list` は `.agents/` 側を表示するので、`git status` で `.claude/skills/` の差分を確かめ、`skills-lock.json` と一緒に commit する。捨てるときは lock のエントリも消す。最後に `find .claude/skills -xtype l` が空であることを確かめる。
