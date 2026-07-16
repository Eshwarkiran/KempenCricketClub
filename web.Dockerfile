# Kempen Cricket Club website — builds the Astro static site and serves it via
# nginx, which also reverse-proxies /api to the Functions container.
# Build context is the repo root:  docker build -f web.Dockerfile -t kcc-web .

# --- Stage 1: build the static site ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build          # outputs to /app/dist

# --- Stage 2: serve with nginx ---
FROM nginx:1.27-alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
