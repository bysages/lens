# use the official Node image
# see all versions at https://hub.docker.com/_/node/tags
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app

# Copy package.json and your lockfile, here we add pnpm-lock.yaml for illustration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# use ignore-scripts to avoid running postinstall hooks
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy the entire project
COPY . .

# Build with node-cluster preset
ENV NITRO_PRESET=node_cluster
ENV NODE_ENV=production
RUN pnpm run build

# copy production dependencies and source code into application image
FROM node:24-slim AS production
WORKDIR /app

# Moli headless browser (https://github.com/lexmount/moli), pinned release
ARG TARGETARCH
ARG MOLI_VERSION=1.1.18
ARG MOLI_AMD64_SHA256=59715fbdb2b016bb9136e1edb59a2a195c0f98459fd06739e17edc62da6a48b1
ARG MOLI_ARM64_SHA256=ec57982984245811e2e9ea59a7b45693c01c38ccf403bbe2ea2b1b3bebd482fb

# ca-certificates for HTTPS, libcurl4 for Moli's network transport,
# libfontconfig1 required by Moli's text layout, base fonts so text does not
# render as tofu (swap fonts-wqy-zenhei for fonts-noto-cjk if you need
# higher-quality CJK glyphs), curl for the container healthcheck
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates libcurl4 curl libfontconfig1 fonts-dejavu-core fonts-wqy-zenhei \
    && rm -rf /var/lib/apt/lists/*

# Install the Moli binary for the target architecture, verifying its checksum
RUN case "$TARGETARCH" in \
        amd64) MOLI_TARGET=x86_64; MOLI_SHA256="$MOLI_AMD64_SHA256" ;; \
        arm64) MOLI_TARGET=aarch64; MOLI_SHA256="$MOLI_ARM64_SHA256" ;; \
        *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && curl --fail --connect-timeout 20 --retry 5 --retry-delay 2 --retry-all-errors -Lo /tmp/moli.tar.gz \
        "https://github.com/lexmount/moli/releases/download/v${MOLI_VERSION}/moli-${MOLI_TARGET}-unknown-linux-gnu.tar.gz" \
    && echo "${MOLI_SHA256}  /tmp/moli.tar.gz" | sha256sum -c - \
    && mkdir /tmp/moli-pkg \
    && tar -xzf /tmp/moli.tar.gz -C /tmp/moli-pkg --strip-components=1 \
    && install -m 0755 /tmp/moli-pkg/moli /usr/local/bin/moli \
    && moli --version \
    && rm -rf /tmp/moli-pkg /tmp/moli.tar.gz

# Copy .output directory
COPY --from=build /app/.output /app

# Supervise Moli alongside the Node app
COPY docker/entrypoint.sh /usr/local/bin/lens-entrypoint
RUN chmod 0755 /usr/local/bin/lens-entrypoint

# Run as an unprivileged user: the app renders untrusted pages and images
RUN groupadd -r lens && useradd -r -g lens lens \
    && chown -R lens:lens /app
USER lens

# Set env vars
ENV NODE_ENV=production
ENV PORT=3000
# Moli serves unauthenticated CDP on loopback only; never expose 9222
ENV BROWSER_CDP_ENDPOINT=http://127.0.0.1:9222
# --block-private-networks (the browser-level SSRF guard) is hardcoded in
# the entrypoint and cannot be dropped via MOLI_FLAGS
ENV MOLI_VERSION=${MOLI_VERSION}
ENV XDG_CACHE_HOME=/tmp/lens-cache
# Bound Moli's outbound fan-out and reuse HTTP responses across screenshots.
ENV MOLI_FLAGS="--layout --resource --http-cache-dir=/tmp/lens-cache/moli-http --http-max-concurrent=32 --http-max-total-connections=64"

# run the app
ENTRYPOINT ["/usr/local/bin/lens-entrypoint"]
