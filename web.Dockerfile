# Kempen Cricket Club website — builds the Astro static site and serves it via
# nginx, which also reverse-proxies /api to the Functions container.
# Build context is the repo root:  docker build -f web.Dockerfile -t kcc-web .
#
# Public frontend config (Turnstile site key + client credential) is baked in at
# build time via ARGs so dev/prod can use different values. Leaving an ARG empty
# keeps whatever is already committed in forms.js (handy for local builds).

# --- Stage 1: build the static site ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .

# Inject per-environment public frontend values into forms.js before the build
# copies public/ into dist/. These are NOT secrets — they ship to the browser.
ARG TURNSTILE_SITE_KEY=""
ARG CLIENT_USER=""
ARG CLIENT_PASS=""
RUN set -e; F=public/assets/forms.js; \
    if [ -n "$TURNSTILE_SITE_KEY" ]; then sed -i "s|var TURNSTILE_SITE_KEY = \"[^\"]*\"|var TURNSTILE_SITE_KEY = \"$TURNSTILE_SITE_KEY\"|" "$F"; fi; \
    if [ -n "$CLIENT_USER" ]; then sed -i "s|var CLIENT_USER = \"[^\"]*\"|var CLIENT_USER = \"$CLIENT_USER\"|" "$F"; fi; \
    if [ -n "$CLIENT_PASS" ]; then sed -i "s|var CLIENT_PASS = \"[^\"]*\"|var CLIENT_PASS = \"$CLIENT_PASS\"|" "$F"; fi

RUN npm run build          # outputs to /app/dist

# --- Stage 2: serve with nginx ---
FROM nginx:1.27-alpine
# nginx template: entrypoint runs envsubst on ${API_UPSTREAM} at container start.
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
# Default upstream for a single Azure Container App (web + api share localhost).
# docker-compose overrides this to api:8080.
ENV API_UPSTREAM=localhost:8080
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
