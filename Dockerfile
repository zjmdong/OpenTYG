# Zero runtime dependencies; production defaults fail closed until configured.
ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE}
LABEL org.opencontainers.image.title="OpenTYG" org.opencontainers.image.version="1.2.2" \
      org.opencontainers.image.source="https://github.com/zjmdong/OpenTYG" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 DATA_DIR=/data LOG_QUIET=0
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY web ./web
COPY deploy/healthcheck.mjs ./deploy/healthcheck.mjs
# COPY preserves source permissions; private host files may be unreadable
# to the runtime UID. Normalize public application code only, before switching user.
RUN addgroup -S -g 10001 opentyg && adduser -S -D -u 10001 -G opentyg opentyg \
 && chown -R root:root /app \
 && find /app -type d -exec chmod 0755 {} + \
 && find /app -type f -exec chmod 0644 {} + \
 && mkdir -p /data && chown opentyg:opentyg /data
USER 10001:10001
RUN node --check server/index.mjs && node --check deploy/healthcheck.mjs
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=6s --start-period=15s --retries=3 CMD ["node", "deploy/healthcheck.mjs"]
CMD ["node", "server/index.mjs"]
