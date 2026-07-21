# Kempen Cricket Club form APIs — Azure Functions v4 (Node 20) container.
# Build context is this api/ folder:  docker build -t kcc-api ./api
#
# The Azure Functions runtime image is published only for linux/amd64, so the
# platform is pinned. On Apple Silicon (arm64) this runs under emulation, which
# matches the amd64 servers it deploys to.

FROM --platform=linux/amd64 mcr.microsoft.com/azure-functions/node:4-node20

# The runtime looks for the app here and logs to the container console.
# Listen on 8080 (not the default 80): in a single Azure Container App the web
# (nginx) and api containers share one network namespace, so they can't both
# bind 80. nginx proxies /api to localhost:8080.
ENV AzureWebJobsScriptRoot=/home/site/wwwroot \
    AzureFunctionsJobHost__Logging__Console__IsEnabled=true \
    FUNCTIONS_WORKER_RUNTIME=node \
    ASPNETCORE_URLS=http://+:8080 \
    WEBSITES_PORT=8080

WORKDIR /home/site/wwwroot

# Install production dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy the function app source. local.settings.json is excluded via .dockerignore
# so no secrets are baked into the image — supply them at runtime instead.
COPY . .

EXPOSE 8080
