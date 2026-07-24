FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV AUTH_SECRET="placeholder-build-time-secret-not-used-at-runtime"
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Prisma 5.x's engine auto-detection picks the wrong (unsuffixed, pre-OpenSSL-3
# naming) binary on current Alpine, even though the correctly-named
# linux-musl-openssl-3.0.x engine is also generated and present. openssl1.1-compat
# no longer exists in Alpine's repos to paper over that, so instead: install
# current openssl (for real libssl.so.3), and force Prisma to load the
# correctly-named engine directly instead of relying on its detection.
RUN apk add --no-cache openssl
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node
EXPOSE 3000
CMD ["node", "server.js"]
