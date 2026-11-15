# The build stages run on the builder's own platform: the standalone output is plain JS (sharp is excluded and PGlite is
# WebAssembly), so the arm64 image is built without emulating Next.
FROM --platform=$BUILDPLATFORM oven/bun:1.4.4 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

FROM --platform=$BUILDPLATFORM node:26.13.1-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next traces demo/ into the standalone output because code reads it by path; the store image must not carry it.
RUN --mount=type=cache,target=/app/.next/cache node node_modules/next/dist/bin/next build && rm -rf .next/standalone/demo

# Alpine: the runtime and ffmpeg take a fraction of the Debian size, so updates download less and the disk lasts longer.
FROM node:26.13.1-alpine AS app
# Before any COPY, so this layer stays cached across releases.
RUN apk add --no-cache ffmpeg && mkdir /data && chown node:node /data
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NEXT_MANUAL_SIG_HANDLE=1 PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data
COPY --from=build /app/src/lib/migrations ./src/lib/migrations
COPY --from=build /app/public ./public
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/.next/standalone ./
# Set by the release workflow to the git tag, shown in the admin and compared with the latest release.
ARG VERSION=dev
ENV APP_VERSION=$VERSION
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]

# The public demo (DEMO_MODE=1): the store image plus its seeds and media. Build it with --target demo.
FROM app AS demo
COPY demo ./demo

# Last, so a build without --target (compose, the release) produces the store image without demo/.
FROM app
