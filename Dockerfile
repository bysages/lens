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

# Install playwright
RUN npx -y playwright install --with-deps --only-shell

# Copy .output directory
COPY --from=build /app/.output /app

# Set env vars
ENV NODE_ENV=production
ENV PORT=3000

# run the app
ENTRYPOINT ["sh", "-c", "node /app/server/index.mjs"]