# The built frontend, served by Caddy. Caddy also forwards /api, /auth and /admin to the API (Caddyfile),
# so the browser sees one origin, as with the Vite proxy in development.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
