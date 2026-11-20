# ─── Stage 1 : deps ──────────────────────────────────────────────────────────
# Installe uniquement les dépendances npm (cache layer réutilisable).
FROM node:20-alpine AS deps

WORKDIR /app

# openssl : requis par le moteur Prisma sur Alpine (linux-musl-openssl-3.0.x)
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY schema.prisma ./
RUN npm ci && npx prisma generate

# ─── Stage 2 : dev ───────────────────────────────────────────────────────────
# Cible par défaut pour docker-compose en développement.
# ts-node tourne directement sur le source TypeScript.
FROM deps AS dev

WORKDIR /app

# curl est requis pour le healthcheck défini dans docker-compose.yml
RUN apk add --no-cache curl

COPY tsconfig.json ./
COPY src ./src

EXPOSE 4000

CMD ["npm", "run", "dev"]

# ─── Stage 3 : build ─────────────────────────────────────────────────────────
# Compile le TypeScript vers dist/ après génération du client Prisma.
# Cette image (CLI prisma + schéma + migrations) sert aussi au service
# one-shot `migrate` (prisma migrate deploy) en production.
FROM deps AS build

WORKDIR /app

COPY schema.prisma ./
COPY migrations ./migrations
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ─── Stage 4 : prod ──────────────────────────────────────────────────────────
# Image minimale : uniquement le JS compilé et les dépendances de production.
FROM node:20-alpine AS prod

WORKDIR /app

# openssl : moteur Prisma
RUN apk add --no-cache openssl

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Client Prisma généré au stage build (le CLI prisma n'est pas en dépendance prod)
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist

EXPOSE 4000

CMD ["node", "dist/server.js"]
