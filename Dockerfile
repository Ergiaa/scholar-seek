# Stage 1: Dependencies
FROM oven/bun:1.3.8 AS dependencies
WORKDIR /app
COPY . .
RUN bun install

# Stage 2: Builder
FROM dependencies AS builder
ENV NODE_ENV=production
ENV SKIP_ENV_VALIDATION=1
RUN bun run build

# Stage 3: Runner
FROM oven/bun:1.3.8-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=builder /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder /app/apps/server/package.json ./apps/server/package.json
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder /app/package.json ./package.json
COPY start.sh ./start.sh
RUN chmod +x start.sh
RUN sed -i 's/\r$//' start.sh
EXPOSE 3000
CMD ["sh", "start.sh"]