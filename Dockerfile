# syntax=docker/dockerfile:1

# ---- build stage: compile native deps (better-sqlite3, bcrypt, sharp) ----
FROM node:20-slim AS build
WORKDIR /app

# Toolchain needed to compile better-sqlite3 and bcrypt from source.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# ---- runtime stage: slim image, no toolchain ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Bring over the built tree (includes node_modules with compiled binaries).
COPY --from=build /app ./

RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
