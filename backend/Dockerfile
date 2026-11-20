# ─── Stage 1 : deps ──────────────────────────────────────────────────────────
# Installe uniquement les dépendances npm (cache layer réutilisable).
FROM node:20-alpine AS deps

WORKDIR /app

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
# Compile le TypeScript vers dist/.
FROM deps AS build

WORKDIR /app

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ─── Stage 4 : prod ──────────────────────────────────────────────────────────
# Image minimale : uniquement le JS compilé et les dépendances de production.
FROM node:20-alpine AS prod

WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY schema.prisma ./
RUN npm ci --omit=dev && npx prisma generate

COPY --from=build /app/dist ./dist

EXPOSE 4000

CMD ["node", "dist/server.js"]
