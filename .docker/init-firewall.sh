#!/bin/bash
set -euo pipefail  # Exit on error, undefined vars, and pipeline failures
IFS=$'\n\t'       # Stricter word splitting

# Default-deny egress firewall for the nyalog dev container.
# Allowed: DNS, SSH, localhost, the host /24, GitHub's published IP ranges,
# plus the domains listed in the `for domain in ...` loop below.
# Everything else is REJECTed at the OS level.
#
# NOTE: this script runs as the container entrypoint (via docker-compose `command`),
# so if it `exit 1`s the container stops. A single unresolvable domain in the
# fatal allowlist below will therefore take the whole container down — keep the
# list to domains that reliably resolve and that you actually need.

# 1. Extract Docker DNS info BEFORE any flushing
DOCKER_DNS_RULES=$(iptables-save -t nat | grep "127\.0\.0\.11" || true)

# Flush existing rules and delete existing ipsets
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X
ipset destroy allowed-domains 2>/dev/null || true

# 2. Selectively restore ONLY internal Docker DNS resolution
if [ -n "$DOCKER_DNS_RULES" ]; then
    echo "Restoring Docker DNS rules..."
    iptables -t nat -N DOCKER_OUTPUT 2>/dev/null || true
    iptables -t nat -N DOCKER_POSTROUTING 2>/dev/null || true
    echo "$DOCKER_DNS_RULES" | xargs -L 1 iptables -t nat
else
    echo "No Docker DNS rules to restore"
fi

# First allow DNS and localhost before any restrictions
# Allow outbound DNS
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
# Allow inbound DNS responses
iptables -A INPUT -p udp --sport 53 -j ACCEPT
# Allow outbound SSH
iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT
# Allow inbound SSH responses
iptables -A INPUT -p tcp --sport 22 -m state --state ESTABLISHED -j ACCEPT
# Allow localhost
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# Create ipset with CIDR support
ipset create allowed-domains hash:net

# Fetch GitHub meta information and aggregate + add their IP ranges
echo "Fetching GitHub IP ranges..."
gh_ranges=$(curl -s https://api.github.com/meta)
if [ -z "$gh_ranges" ]; then
    echo "ERROR: Failed to fetch GitHub IP ranges"
    exit 1
fi

if ! echo "$gh_ranges" | jq -e '.web and .api and .git' >/dev/null; then
    echo "ERROR: GitHub API response missing required fields"
    exit 1
fi

echo "Processing GitHub IPs..."
while read -r cidr; do
    if [[ ! "$cidr" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/[0-9]{1,2}$ ]]; then
        echo "ERROR: Invalid CIDR range from GitHub meta: $cidr"
        exit 1
    fi
    echo "Adding GitHub range $cidr"
    ipset add allowed-domains "$cidr"
done < <(echo "$gh_ranges" | jq -r '(.web + .api + .git)[]' | aggregate -q)

# ─────────────────────────────────────────────────────────────────────────────
# FATAL allowlist — keep it minimal.
#   registry.npmjs.org          → `pnpm install` / start-time claude+pnpm update
#   api.anthropic.com           → Claude Code model API
#   developers.cloudflare.com   → CF docs (WebFetch)
#   docs.mcp.cloudflare.com     → cloudflare-docs MCP server (auth-free)
#
# DELIBERATELY ABSENT — api.cloudflare.com / dash / workers.cloudflare.com:
# nyalog's dev server runs from wrangler.local.jsonc (no `ai` binding, ADR-008)
# so `vp dev` never opens a Cloudflare remote-proxy session, D1/R2/Workflows are
# local simulations, and deploys/migrations run in Workers Builds — the
# container needs NO Cloudflare API egress and holds NO Cloudflare credential.
# wrangler telemetry (sparrow.cloudflare.com) is silenced via
# WRANGLER_SEND_METRICS=false in compose env instead of an allowlist entry.
#
# Do NOT add sentry.io or VS Code Marketplace domains here: they can
# intermittently fail DNS and take the container down, and the compose env
# (DISABLE_ERROR_REPORTING=1) means Claude Code won't contact Sentry anyway.
# Statsig domains are OPTIONAL below. "statsig.anthropic.com" does NOT exist
# (no A record) — do not re-add it anywhere.
# ─────────────────────────────────────────────────────────────────────────────
for domain in \
    "registry.npmjs.org" \
    "api.anthropic.com" \
    "developers.cloudflare.com" \
    "docs.mcp.cloudflare.com"; do
    echo "Resolving $domain..."
    # Retry: the embedded Docker DNS can intermittently time out at container
    # start (worse when several sandboxes resolve at once). A single failed dig
    # would `exit 1` and kill the container, so try a few times before giving up.
    ips=""
    for attempt in 1 2 3 4 5; do
        ips=$(dig +noall +answer +tries=2 +time=3 A "$domain" | awk '$4 == "A" {print $5}')
        [ -n "$ips" ] && break
        echo "  resolve attempt $attempt for $domain failed, retrying in 2s..."
        sleep 2
    done
    if [ -z "$ips" ]; then
        echo "ERROR: Failed to resolve $domain after 5 attempts"
        exit 1
    fi

    while read -r ip; do
        if [[ ! "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
            echo "ERROR: Invalid IP from DNS for $domain: $ip"
            exit 1
        fi
        echo "Adding $ip for $domain"
        # -exist: Cloudflare 系ドメインは anycast IP を共有するため、同じ IP が別
        # ドメインで既に追加済みのことがある。重複追加でも非ゼロ終了させず、
        # set -e でコンテナが落ちないようにする。
        ipset add -exist allowed-domains "$ip"
    done < <(echo "$ips")
done

# ─────────────────────────────────────────────────────────────────────────────
# OPTIONAL domains: nice-to-have egress that must never block container start.
# Resolution failure logs a WARN and continues (vs the fatal list above).
#   statsig.* / featuregates.org / prodregistryv2.org
#       → Claude Code usage telemetry uploads (model picker works without them;
#         gates arrive via api.anthropic.com)
#   nyalog.toshiaki-mukai-9981.workers.dev
#       → production host, lets the in-container agent verify deploys
#         (e.g. curl -s .../api/auth/me → 401 = serving)
#   cdn.playwright.dev / playwright.download.prss.microsoft.com
#       → best-effort only: Azure Front Door rotates A records per resolution,
#         so a runtime `playwright install` often misses the boot-time ipset
#         (EHOSTUNREACH). The reliable path is the BUILD-TIME bake
#         (Dockerfile PLAYWRIGHT_VERSION); these entries just improve the odds
#         for ad-hoc version bumps without a rebuild.
# ─────────────────────────────────────────────────────────────────────────────
for domain in \
    "statsig.com" \
    "api.statsig.com" \
    "featuregates.org" \
    "statsigapi.net" \
    "prodregistryv2.org" \
    "nyalog.toshiaki-mukai-9981.workers.dev" \
    "cdn.playwright.dev" \
    "playwright.download.prss.microsoft.com"; do
    echo "Resolving optional $domain..."
    ips=""
    for attempt in 1 2 3; do
        ips=$(dig +noall +answer +tries=2 +time=3 A "$domain" | awk '$4 == "A" {print $5}')
        [ -n "$ips" ] && break
        echo "  resolve attempt $attempt for optional $domain failed, retrying in 2s..."
        sleep 2
    done
    if [ -z "$ips" ]; then
        echo "WARN: optional domain $domain not resolved; continuing without it"
        continue
    fi
    while read -r ip; do
        if [[ ! "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
            echo "WARN: invalid IP from DNS for optional $domain: $ip (skipped)"
            continue
        fi
        echo "Adding $ip for $domain"
        ipset add -exist allowed-domains "$ip"
    done < <(echo "$ips")
done

# Get host IP from default route
HOST_IP=$(ip route | grep default | cut -d" " -f3)
if [ -z "$HOST_IP" ]; then
    echo "ERROR: Failed to detect host IP"
    exit 1
fi

HOST_NETWORK=$(echo "$HOST_IP" | sed "s/\.[0-9]*$/.0\/24/")
echo "Host network detected as: $HOST_NETWORK"

# Set up remaining iptables rules
iptables -A INPUT -s "$HOST_NETWORK" -j ACCEPT
iptables -A OUTPUT -d "$HOST_NETWORK" -j ACCEPT

# Set default policies to DROP first
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# First allow established connections for already approved traffic
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Then allow only specific outbound traffic to allowed domains
iptables -A OUTPUT -m set --match-set allowed-domains dst -j ACCEPT

# Explicitly REJECT all other outbound traffic for immediate feedback
iptables -A OUTPUT -j REJECT --reject-with icmp-admin-prohibited

echo "Firewall configuration complete"
echo "Verifying firewall rules..."
if curl --connect-timeout 5 https://example.com >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed - was able to reach https://example.com"
    exit 1
else
    echo "Firewall verification passed - unable to reach https://example.com as expected"
fi

# Verify GitHub API access
if ! curl --connect-timeout 5 https://api.github.com/zen >/dev/null 2>&1; then
    echo "ERROR: Firewall verification failed - unable to reach https://api.github.com"
    exit 1
else
    echo "Firewall verification passed - able to reach https://api.github.com as expected"
fi
