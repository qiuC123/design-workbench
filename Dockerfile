FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
COPY server ./server
RUN npm run build:website
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    SJ_HOST=0.0.0.0 \
    SJ_PORT=4175 \
    SJ_DATA_DIR=/app/.data \
    SJ_STATIC_DIR=/app/dist-website
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
# The API reuses domain validation/migration modules; this directory is not served.
COPY --from=build /app/src ./src
COPY --from=build /app/dist-website ./dist-website
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 4175
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:4175/healthz', {signal: AbortSignal.timeout(3000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "--import", "tsx", "server/main.ts"]
