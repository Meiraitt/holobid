# syntax=docker/dockerfile:1
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
RUN npm install --global npm@11.21.1
COPY package.json package-lock.json .npmrc tsconfig.base.json ./
COPY packages/contracts/ packages/contracts/
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/nest-cli.json apps/api/tsconfig*.json apps/api/
COPY apps/api/prisma*.ts apps/api/
COPY apps/api/prisma/ apps/api/prisma/
RUN npm ci
COPY apps/api/src/ apps/api/src/
RUN npm run build:api

# Explicit release step. Never run migrations while building or starting the API.
FROM build AS migrations
ENV NODE_ENV=production
USER node
CMD ["npm", "run", "db:release"]

FROM build AS production-dependencies
RUN npm prune --omit=dev --omit=optional --omit=peer --ignore-scripts

FROM base AS runtime
ENV NODE_ENV=production PORT=3000
COPY --from=production-dependencies /app/node_modules/ node_modules/
COPY --from=production-dependencies /app/apps/api/node_modules/ apps/api/node_modules/
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/contracts/package.json packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist/ packages/contracts/dist/
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist/ apps/api/dist/
COPY apps/api/fixtures/ apps/api/fixtures/
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
