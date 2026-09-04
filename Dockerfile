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
ARG MOLI_VERSION=1.0.1
ARG MOLI_AMD64_SHA256=1f721d886b36e7a45afd75ce08d611d1582c8ab5a3c4b9275849825fc53bbb7d
ARG MOLI_ARM64_SHA256=8a054e25f32f05ca7585e50c067e4bd359ca78cac95db660214b5056dc161212

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
    && curl -fsSLo /tmp/moli.tar.gz \
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

# Set env vars
ENV NODE_ENV=production
ENV PORT=3000
# Moli serves unauthenticated CDP on loopback only; never expose 9222
ENV BROWSER_CDP_ENDPOINT=http://127.0.0.1:9222
ENV MOLI_FLAGS="--layout --resource --block-private-networks"

# run the app
ENTRYPOINT ["/usr/local/bin/lens-entrypoint"]
