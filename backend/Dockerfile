# One image for the API and the worker; docker-compose.yml gives each its start command.
# The `build` stage also runs the migrations (it has the Prisma CLI).
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json eslint.config.mjs ./
COPY src ./src
# Lints src (including the no-cron rule) and compiles to dist/.
RUN npm run build

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
# --omit=optional: @prisma/client names the Prisma CLI and TypeScript as optional peers, so npm would still install
# them and their tools (~110 MB). The only other optional packages are msgpackr's native speed-ups; it falls back to JS.
# The cache is cleared in the same layer, or it stays in the image (~170 MB).
RUN npm ci --omit=dev --omit=optional && npm cache clean --force
# The generated Prisma client (and its Linux query engine) from the build stage.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/server.js"]
