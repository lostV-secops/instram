# ─── Stage 1 : dépendances de production ────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ─── Stage 2 : toutes les dépendances (dev + prod) ───────────────────────────
FROM node:20-alpine AS all-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ─── Stage 3 : développement (hot-reload) ────────────────────────────────────
FROM node:20-alpine AS dev
WORKDIR /app
COPY --from=all-deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["npm", "run", "dev"]

# ─── Stage 4 : build de production ───────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
# Les variables NEXT_PUBLIC_* sont figées dans le bundle navigateur au build :
# elles doivent être passées en build args (cf. docker-compose.dokploy.yml).
# Elles alimentent aussi la CSP (next.config.js).
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ARG COOKIE_SECURE
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    COOKIE_SECURE=$COOKIE_SECURE \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone
COPY --from=all-deps /app/node_modules ./node_modules
COPY . .
# next build avec output: standalone
RUN npm run build

# ─── Stage 5 : image de production minimale ──────────────────────────────────
FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Copier uniquement ce qui est nécessaire (standalone + statiques)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
