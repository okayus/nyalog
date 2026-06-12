# node >= 22: vite-plus (vp) は vite.config.ts を node ネイティブの型ストリッピング
# (22.18+ で default 有効) で import するため、node:20 だと ERR_UNKNOWN_FILE_EXTENSION
# で vp check すら動かない。CI (check.yml) も node 22 — バージョンを揃える。
FROM node:22

ARG TZ
ENV TZ="$TZ"

ARG CLAUDE_CODE_VERSION=latest

# Install basic development tools and iptables/ipset
RUN apt-get update && apt-get install -y --no-install-recommends \
  less \
  git \
  procps \
  sudo \
  fzf \
  zsh \
  man-db \
  unzip \
  gnupg2 \
  gh \
  iptables \
  ipset \
  iproute2 \
  dnsutils \
  aggregate \
  jq \
  nano \
  vim \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Playwright (chromium) system libraries, baked at BUILD time because runtime
# apt is blocked by the egress firewall. The browser BINARY is fetched at
# runtime via `pnpm exec playwright install chromium` (cdn.playwright.dev is an
# OPTIONAL firewall domain) so its version always matches @playwright/test, and
# is cached in the playwright-browsers named volume.
ARG INSTALL_BROWSER_DEPS=true
RUN if [ "$INSTALL_BROWSER_DEPS" = "true" ]; then \
  apt-get update && apt-get install -y --no-install-recommends \
  libnss3 \
  libnspr4 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libxkbcommon0 \
  libatspi2.0-0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libasound2 \
  libpango-1.0-0 \
  libcairo2 \
  fonts-liberation \
  fonts-noto-color-emoji \
  && apt-get clean && rm -rf /var/lib/apt/lists/* ; \
  fi

# Ensure default node user has access to /usr/local/share
RUN mkdir -p /usr/local/share/npm-global && \
  chown -R node:node /usr/local/share

ARG USERNAME=node

# Persist bash history.
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  && mkdir /commandhistory \
  && touch /commandhistory/.bash_history \
  && chown -R $USERNAME /commandhistory

# Set `DEVCONTAINER` environment variable to help with orientation
ENV DEVCONTAINER=true

# Create workspace and config directories and set permissions.
# ms-playwright is pre-created with node ownership so the named volume mounted
# there (docker-compose.yml) inherits it — otherwise the volume mount point is
# root-owned and `playwright install` fails with EACCES.
RUN mkdir -p /workspace /home/node/.claude /home/node/.cache/ms-playwright && \
  chown -R node:node /workspace /home/node/.claude /home/node/.cache

WORKDIR /workspace

ARG GIT_DELTA_VERSION=0.18.2
RUN ARCH=$(dpkg --print-architecture) && \
  wget "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  sudo dpkg -i "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  rm "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb"

# Set up non-root user
USER node

# Install global packages
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

# Set the default shell to zsh rather than sh
ENV SHELL=/bin/zsh

# Set the default editor and visual
ENV EDITOR=nano
ENV VISUAL=nano

# Default powerline10k theme
ARG ZSH_IN_DOCKER_VERSION=1.2.0
RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/v${ZSH_IN_DOCKER_VERSION}/zsh-in-docker.sh)" -- \
  -p git \
  -p fzf \
  -a "source /usr/share/doc/fzf/examples/key-bindings.zsh" \
  -a "source /usr/share/doc/fzf/examples/completion.zsh" \
  -a "export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  -x

# Install Claude
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

# Playwright chromium baked at BUILD time (no firewall during build):
# cdn.playwright.dev sits behind Azure Front Door whose A records rotate per
# resolution, so runtime downloads through the IP-pinned egress allowlist fail
# intermittently (EHOSTUNREACH on an IP that wasn't in the set at boot).
# Pin PLAYWRIGHT_VERSION to the repo's @playwright/test and bump both together,
# then rebuild — a version mismatch shows up as "Executable doesn't exist at
# .../chromium-XXXX" when running e2e.
ARG PLAYWRIGHT_VERSION=1.59.1
RUN if [ "$INSTALL_BROWSER_DEPS" = "true" ]; then \
      npx -y playwright@${PLAYWRIGHT_VERSION} install chromium ; \
    fi

# ── Optional language toolchains (opt-in via build args) ─────────────────────
# A Node base is required regardless of project language because Claude Code
# itself is an npm package. These toolchains are layered on top and only
# installed when their build arg is "true". nyalog is TS-only — both stay false.
#
# IMPORTANT: these download at BUILD time, BEFORE init-firewall.sh runs (the
# firewall is the container entrypoint, not part of the image build). So the
# toolchain CDNs do NOT need to be in the runtime allowlist — only the package
# registries you fetch from during development do (see init-firewall.sh).

ARG INSTALL_RUST=false
ARG RUST_VERSION=1.78.0
RUN if [ "$INSTALL_RUST" = "true" ]; then \
      curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
        | sh -s -- -y --default-toolchain "${RUST_VERSION}" --profile minimal ; \
    fi
ENV PATH=$PATH:/home/node/.cargo/bin

ARG INSTALL_HASKELL=false
ARG GHC_VERSION=9.6.5
ARG CABAL_VERSION=3.10.3.0
RUN if [ "$INSTALL_HASKELL" = "true" ]; then \
      export BOOTSTRAP_HASKELL_NONINTERACTIVE=1 \
             BOOTSTRAP_HASKELL_GHC_VERSION="${GHC_VERSION}" \
             BOOTSTRAP_HASKELL_CABAL_VERSION="${CABAL_VERSION}" \
             BOOTSTRAP_HASKELL_INSTALL_NO_STACK=1 ; \
      curl --proto '=https' --tlsv1.2 -sSf https://get-ghcup.haskell.org | sh ; \
    fi
ENV PATH=$PATH:/home/node/.ghcup/bin


# Copy and set up firewall script
COPY init-firewall.sh /usr/local/bin/
USER root
RUN chmod +x /usr/local/bin/init-firewall.sh && \
  echo "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/node-firewall && \
  chmod 0440 /etc/sudoers.d/node-firewall
USER node
