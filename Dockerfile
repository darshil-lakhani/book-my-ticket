# ── Build stage ──────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# ── Runtime stage ─────────────────────────────────────────
FROM node:22-alpine AS runner

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy deps from build stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY index.mjs  ./
COPY index.html ./

# Own everything as non-root
RUN chown -R appuser:appgroup /app
USER appuser

# Coolify injects env vars at runtime — no .env file needed in the image
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# node 20+ built-in env loading; falls back gracefully if .env absent
CMD ["node", "index.mjs"]
