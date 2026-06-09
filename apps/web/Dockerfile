# Build stage
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package.json bun.lock tsconfig.json turbo.json ./

# Copy workspace packages
COPY packages packages
COPY apps apps

# Install dependencies
RUN bun install

# Build the web app
RUN cd apps/web && bun run build

# Runtime stage
FROM oven/bun:1-alpine

WORKDIR /app

# Copy built artifacts from builder
COPY --from=builder /app/apps/web/dist ./dist

# Expose port
EXPOSE 3001

# Serve the built app using bun's built-in server
CMD ["bun", "run", "--", "bunx", "serve", "-s", "dist", "-l", "3001"]
