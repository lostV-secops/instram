# InsTRAM — Guide de déploiement et de mise en production

| Champ | Valeur |
|---|---|
| Projet | InsTRAM |
| Organisation | CODEL Technologies Co. |
| Version du guide | 1.0 — Septembre 2026 |
| Stack | Node.js 20 · Next.js 14 · PostgreSQL 15 · Redis 7 · Docker |

---

## Table des matières

1. [Prérequis](#1-prérequis)
2. [Architecture de déploiement](#2-architecture-de-déploiement)
3. [Variables d'environnement](#3-variables-denvironnement)
4. [Développement local (Docker Compose)](#4-développement-local-docker-compose)
5. [Build de production](#5-build-de-production)
6. [Déploiement production](#6-déploiement-production)
7. [Base de données — migrations et seed](#7-base-de-données--migrations-et-seed)
8. [Reverse proxy Nginx](#8-reverse-proxy-nginx)
9. [Health checks](#9-health-checks)
10. [Surveillance et logs](#10-surveillance-et-logs)
11. [Sauvegardes et restauration](#11-sauvegardes-et-restauration)
12. [Procédure de rollback](#12-procédure-de-rollback)
13. [Checklist de sécurité](#13-checklist-de-sécurité)
14. [Agents ayant travaillé sur le projet](#14-agents-ayant-travaillé-sur-le-projet)

---

## 1. Prérequis

### Serveur de production (minimum recommandé)

| Composant | Minimum | Recommandé |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 Go | 8 Go |
| Disque | 40 Go SSD | 100 Go SSD |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |

### Logiciels requis sur le serveur

```bash
# Docker Engine 24+
curl -fsSL https://get.docker.com | sh

# Docker Compose Plugin (v2)
sudo apt install docker-compose-plugin

# Vérifier les versions
docker --version          # Docker version 24+
docker compose version    # Docker Compose version v2.20+
```

### Ports à ouvrir (pare-feu / security groups)

| Port | Protocole | Usage |
|---|---|---|
| 80 | TCP | HTTP → redirection HTTPS |
| 443 | TCP | HTTPS (Nginx reverse proxy) |
| 22 | TCP | SSH (restreindre aux IPs de l'équipe) |

> Les ports 3000 (frontend), 4000 (backend), 5432 (PostgreSQL) et 6379 (Redis) **ne doivent jamais être exposés directement** sur Internet. Ils restent internes au réseau Docker.

---

## 2. Architecture de déploiement

```
Internet
    │ HTTPS 443
    ▼
┌───────────────────────────────────────┐
│  Nginx (reverse proxy + TLS/Let's     │
│  Encrypt)                             │
│  instram.mg → :3000 (Next.js)         │
│  api.instram.mg → :4000 (Fastify)     │
│  api.instram.mg/ws → WebSocket :4000  │
└───────┬───────────────────┬───────────┘
        │                   │
   ┌────▼────┐         ┌────▼────────────┐
   │ Next.js  │         │ Fastify Backend │
   │ :3000    │◄──REST──│ :4000           │
   │ (SSR +   │         │                 │
   │  static) │         └────┬──────┬─────┘
   └──────────┘              │      │
                        ┌────▼──┐ ┌─▼──────┐
                        │ Pg 15 │ │ Redis 7│
                        │ :5432 │ │ :6379  │
                        └───────┘ └────────┘
```

**Réseau Docker interne** : tous les services communiquent par leur nom de service Docker (`postgres`, `redis`, `backend`, `frontend`). Seul Nginx écoute sur les ports publics.

---

## 3. Variables d'environnement

### 3.1 Backend (`backend/.env`)

Copier `.env.example` et remplir chaque valeur :

```bash
cp backend/.env.example backend/.env
```

| Variable | Description | Exemple production |
|---|---|---|
| `DATABASE_URL` | URL complète PostgreSQL | `postgresql://instram:SECRET@postgres:5432/instram_prod` |
| `REDIS_URL` | URL Redis | `redis://redis:6379` |
| `JWT_ACCESS_SECRET` | Secret JWT access token (≥ 64 chars) | Générer avec `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | Secret JWT refresh token (≥ 64 chars) | Générer avec `openssl rand -hex 32` |
| `JWT_ACCESS_EXPIRES_IN` | Durée access token | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Durée refresh token | `90d` |
| `PORT` | Port d'écoute backend | `4000` |
| `NODE_ENV` | Environnement | `production` |
| `SMS_PROVIDER` | Fournisseur SMS : `stub` / `orange` / `telma` | `orange` |
| `ORANGE_SMS_URL` | URL API Orange SMS | `https://api.orange.mg/smsmessaging/v1` |
| `ORANGE_SMS_KEY` | Clé API Orange SMS | *Fournie par Orange Madagascar* |
| `MVOLA_CLIENT_ID` | ID client MVola | *Fourni par Telma* |
| `MVOLA_CLIENT_SECRET` | Secret client MVola | *Fourni par Telma* |
| `MVOLA_WEBHOOK_SECRET` | Secret HMAC webhook MVola | Générer avec `openssl rand -hex 32` |
| `MVOLA_MERCHANT_NUMBER` | Numéro marchand MVola | *Fourni par Telma* |
| `MVOLA_CALLBACK_URL` | URL de callback webhook | `https://api.instram.mg/v1/webhooks/mobile-money/mvola` |
| `ORANGE_MONEY_TOKEN` | Token Orange Money | *Fourni par Orange* |
| `ORANGE_MONEY_WEBHOOK_SECRET` | Secret HMAC webhook OM | Générer avec `openssl rand -hex 32` |
| `QR_SECRET` | Secret HMAC signature QR billets | Générer avec `openssl rand -hex 32` |
| `CORS_ORIGIN` | Origine autorisée CORS | `https://instram.mg` |
| `FRONTEND_URL` | URL publique du frontend | `https://instram.mg` |
| `TRUSTED_PROXY_IPS` | CIDR des proxies devant le backend | `10.0.0.0/8` (réseau Docker interne) |
| `SILENCE_START_HOUR` | Début silence nocturne SMS (UTC+3) | `21` |
| `SILENCE_END_HOUR` | Fin silence nocturne SMS (UTC+3) | `6` |
| `STORAGE_PROVIDER` | Stockage exports : `local` / `s3` | `s3` |
| `S3_BUCKET_NAME` | Nom bucket S3 | `instram-exports` |
| `AWS_REGION` | Région AWS | `eu-west-3` |
| `AWS_ACCESS_KEY_ID` | Clé AWS | *Via IAM / secrets manager* |
| `AWS_SECRET_ACCESS_KEY` | Secret AWS | *Via IAM / secrets manager* |

> **Règle absolue** : ne jamais committer un `.env` contenant de vraies clés. Utiliser les secrets du CI/CD (GitHub Actions Secrets, Vault, AWS Secrets Manager).

### 3.2 Frontend (`frontend/.env.local`)

```bash
# URL interne Docker (SSR — Server Components)
BACKEND_URL=http://backend:4000

# URL publique (navigateur — Client Components)
NEXT_PUBLIC_API_URL=https://api.instram.mg

# URL WebSocket publique
NEXT_PUBLIC_WS_URL=wss://api.instram.mg/ws

NODE_ENV=production
PORT=3000
```

---

## 4. Développement local (Docker Compose)

```bash
# 1. Cloner le projet
git clone https://github.com/codel-technologies/instram.git
cd instram

# 2. Configurer les variables d'environnement
cp backend/.env.example backend/.env
# Éditer backend/.env — les valeurs par défaut fonctionnent pour le dev

# 3. Démarrer tous les services (PostgreSQL + Redis + Backend + Frontend)
docker compose up -d

# 4. Appliquer les migrations et seeder la base
docker compose exec backend npx prisma migrate dev
docker compose exec backend npm run seed

# 5. Vérifier que tout tourne
docker compose ps
docker compose logs -f backend
```

URLs locales après démarrage :
- Frontend : http://localhost:3000
- API : http://localhost:4000
- Health : http://localhost:4000/healthz

---

## 5. Build de production

Les Dockerfiles multi-stages génèrent des images minimales pour la production.

```bash
# Build image backend (stage 'prod' — JS compilé uniquement)
docker build -t instram/backend:latest --target prod ./backend

# Build image frontend (stage 'prod' — Next.js standalone)
docker build -t instram/frontend:latest --target prod ./frontend
```

Taille cible des images :
- Backend : < 200 Mo (Node 20 alpine + dist/ compilé)
- Frontend : < 250 Mo (Next.js standalone sans node_modules dev)

---

## 6. Déploiement production

### 6.1 Docker Compose de production

Créer `docker-compose.prod.yml` sur le serveur (ne pas committer avec les secrets) :

```yaml
version: "3.9"

volumes:
  pgdata:
  redisdata:

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: instram
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: instram_prod
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U instram"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes:
      - redisdata:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    image: instram/backend:latest
    env_file: ./backend/.env
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - "127.0.0.1:4000:4000"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/healthz"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 30s

  frontend:
    image: instram/frontend:latest
    env_file: ./frontend/.env.local
    depends_on:
      backend:
        condition: service_healthy
    ports:
      - "127.0.0.1:3000:3000"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 40s
```

### 6.2 Procédure de déploiement

```bash
# Sur le serveur de production

# 1. Mettre à jour les images
docker pull instram/backend:latest
docker pull instram/frontend:latest

# 2. Appliquer les migrations AVANT de redémarrer les conteneurs
docker compose -f docker-compose.prod.yml run --rm backend \
  npx prisma migrate deploy

# 3. Redémarrer les services (zero-downtime si load balancer)
docker compose -f docker-compose.prod.yml up -d --no-build

# 4. Vérifier la santé
docker compose -f docker-compose.prod.yml ps
curl -s https://api.instram.mg/healthz | jq .
curl -s https://instram.mg/api/health | jq .
```

---

## 7. Base de données — migrations et seed

### Migrations Prisma

```bash
# Développement — génère + applique la migration
npx prisma migrate dev --name <nom-de-la-migration>

# Production — applique les migrations en attente (jamais migrate dev en prod)
npx prisma migrate deploy

# Vérifier l'état des migrations
npx prisma migrate status
```

### Seed initial

```bash
# Peuple les villes (119 districts Madagascar) et les données initiales
npm run seed
```

Le script de seed se trouve dans `backend/src/infra/db/seed.ts`. Il est idempotent (peut être relancé sans risque).

### Générer le client Prisma après modification du schéma

```bash
npx prisma generate
```

---

## 8. Reverse proxy Nginx

### Configuration recommandée

Fichier `/etc/nginx/sites-available/instram` :

```nginx
# --- Frontend (instram.mg) ---
server {
    listen 443 ssl http2;
    server_name instram.mg www.instram.mg;

    ssl_certificate     /etc/letsencrypt/live/instram.mg/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/instram.mg/privkey.pem;

    # Sécurité TLS
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;

    # Cache des assets statiques Next.js
    location /_next/static/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_cache_valid 200 365d;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# --- API Backend (api.instram.mg) ---
server {
    listen 443 ssl http2;
    server_name api.instram.mg;

    ssl_certificate     /etc/letsencrypt/live/api.instram.mg/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.instram.mg/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    add_header Strict-Transport-Security "max-age=63072000" always;

    # WebSocket (temps réel sièges)
    location /ws {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Limite de taille (upload manifeste)
        client_max_body_size 10M;
    }
}

# Redirection HTTP → HTTPS
server {
    listen 80;
    server_name instram.mg www.instram.mg api.instram.mg;
    return 301 https://$host$request_uri;
}
```

### Certificats TLS (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d instram.mg -d www.instram.mg -d api.instram.mg
# Le renouvellement automatique est activé par certbot
```

---

## 9. Health checks

### Endpoints disponibles

| Endpoint | Service | Ce qu'il vérifie |
|---|---|---|
| `GET /healthz` | Backend | Connexion PostgreSQL + Redis |
| `GET /api/health` | Frontend | Joignabilité du backend |

```bash
# Vérification manuelle
curl https://api.instram.mg/healthz
# Réponse attendue : {"status":"ok","db":"ok","redis":"ok"}

curl https://instram.mg/api/health
# Réponse attendue : {"status":"ok"}
```

### Surveillance automatique

Ajouter un cron pour alerter en cas de panne :

```bash
# /etc/cron.d/instram-healthcheck
*/5 * * * * root curl -sf https://api.instram.mg/healthz > /dev/null || \
  echo "ALERTE: backend InsTRAM DOWN" | mail -s "InsTRAM ALERTE" ops@codel.mg
```

---

## 10. Surveillance et logs

### Logs Docker

```bash
# Tous les services en temps réel
docker compose -f docker-compose.prod.yml logs -f

# Backend uniquement (avec timestamps)
docker compose -f docker-compose.prod.yml logs -f --timestamps backend

# Dernières 200 lignes d'erreurs backend
docker compose -f docker-compose.prod.yml logs backend 2>&1 | grep -i "error\|fatal" | tail -200
```

### Logs structurés (Pino)

Le backend émet des logs JSON via **Pino**. En production, les diriger vers un agrégateur :

```bash
# Exemple — redirection vers un fichier rotatif
docker compose -f docker-compose.prod.yml logs -f backend | \
  tee -a /var/log/instram/backend.log
```

Format d'un log d'erreur :
```json
{"level":50,"time":1700000000000,"pid":1,"hostname":"backend","msg":"Payment webhook error","err":{...}}
```

### Métriques à surveiller

| Métrique | Seuil d'alerte |
|---|---|
| RAM backend | > 80 % |
| Connexions PostgreSQL actives | > 80 (max = 100 par défaut) |
| File BullMQ SMS en attente | > 500 jobs |
| Latence P95 `/v1/search` | > 2 s |
| Taux d'erreur 5xx | > 1 % sur 5 min |

---

## 11. Sauvegardes et restauration

### Sauvegarde PostgreSQL (quotidienne)

```bash
#!/bin/bash
# /etc/cron.daily/instram-backup

BACKUP_DIR=/backups/instram
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Dump compressé
docker compose -f /opt/instram/docker-compose.prod.yml exec -T postgres \
  pg_dump -U instram instram_prod | gzip > $BACKUP_DIR/instram_prod_$DATE.sql.gz

# Conserver les 30 derniers backups
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete

echo "Backup OK : $BACKUP_DIR/instram_prod_$DATE.sql.gz"
```

Rendre le script exécutable :
```bash
chmod +x /etc/cron.daily/instram-backup
```

### Restauration

```bash
# 1. Arrêter le backend (éviter les écritures pendant la restauration)
docker compose -f docker-compose.prod.yml stop backend frontend

# 2. Restaurer le dump
gunzip -c /backups/instram/instram_prod_YYYYMMDD_HHMMSS.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U instram -d instram_prod

# 3. Relancer les services
docker compose -f docker-compose.prod.yml start backend frontend

# 4. Vérifier la santé
curl https://api.instram.mg/healthz
```

### Sauvegarde Redis (AOF activé)

Redis est configuré avec `--appendonly yes` : le fichier `appendonly.aof` dans le volume `redisdata` est sauvegardé automatiquement à chaque écriture. Le volume Docker est inclus dans les backups système habituels du serveur.

---

## 12. Procédure de rollback

En cas de déploiement défectueux :

```bash
# 1. Identifier le tag de la version précédente
docker images instram/backend

# 2. Revenir à la version précédente
docker tag instram/backend:previous instram/backend:rollback

# 3. Modifier docker-compose.prod.yml pour utiliser le tag 'rollback'
# image: instram/backend:rollback

# 4. Redémarrer
docker compose -f docker-compose.prod.yml up -d backend

# 5. Si la migration est incompatible — restaurer la base depuis le backup
#    (voir section 11 — Restauration)
```

> **Règle** : toujours sauvegarder la base AVANT un déploiement contenant des migrations `ALTER TABLE` ou `DROP COLUMN`.

---

## 13. Checklist de sécurité

Avant chaque mise en production, valider les points suivants :

### Secrets
- [ ] Aucun `.env` avec de vraies clés n'est committé dans Git
- [ ] `JWT_ACCESS_SECRET` et `JWT_REFRESH_SECRET` font au moins 64 caractères aléatoires
- [ ] `QR_SECRET` est unique et ne correspond pas à la valeur dev
- [ ] Les secrets Mobile Money (MVola, Orange Money) sont ceux de production (pas sandbox)
- [ ] Les clés AWS utilisent un rôle IAM à moindre privilège

### Réseau
- [ ] PostgreSQL non accessible depuis Internet (port 5432 fermé sur le pare-feu)
- [ ] Redis non accessible depuis Internet (port 6379 fermé sur le pare-feu)
- [ ] `TRUSTED_PROXY_IPS` correctement renseigné (IP du réseau Docker interne)
- [ ] HTTPS activé sur les deux domaines (`instram.mg` et `api.instram.mg`)
- [ ] HSTS activé dans Nginx

### Application
- [ ] `NODE_ENV=production` dans tous les services
- [ ] `SMS_PROVIDER` réglé sur `orange` ou `telma` (pas `stub`)
- [ ] `CORS_ORIGIN=https://instram.mg` (domaine de production exact)
- [ ] `STORAGE_PROVIDER=s3` pour les exports (pas `local`)
- [ ] Rate limiting actif sur les endpoints `/v1/auth/*`
- [ ] Logs de niveau `warn` minimum (pas `debug`) en production

### Base de données
- [ ] Toutes les migrations Prisma appliquées (`npx prisma migrate status`)
- [ ] Le seed a été exécuté (119 districts villes présents)
- [ ] Mot de passe PostgreSQL différent du dev et suffisamment fort
- [ ] Backups automatiques configurés et testés (restauration vérifiée)

---

## 14. Agents ayant travaillé sur le projet

Ce projet a été développé par une équipe d'agents IA spécialisés, pilotés par le porteur de projet Jacques Chilas (CODEL Technologies Co.).

| Agent | Rôle | Contributions principales |
|---|---|---|
| **Architecte** | Définition de l'architecture technique | `docs/architecture.md`, `schema.prisma`, `docs/contrat-api.yaml`, décisions VH-01 à VH-13 |
| **Backend** | API REST et logique métier | Modules auth, bookings, payments, trips, cooperative, admin, notifications, driver, seats, catalog |
| **Frontend** | Interfaces Next.js | App voyageur (`[lang]/`), back-office coop (`fr/coop/`), app conducteur (`fr/driver/`), console admin (`fr/admin/`) |
| **Realtime** | WebSocket temps réel | Serveur Socket.io, canaux `trip:{id}`, prévention double réservation, hold provisoire 7 min |
| **QA** | Tests end-to-end Playwright | Parcours réservation, back-office coopérative, embarquement conducteur (fichiers `e2e/`) |
| **DevOps** | Infrastructure et CI/CD | `Dockerfile` multi-stages (backend + frontend), `docker-compose.yml`, scripts de migration |
| **Securite** | Revue de sécurité | Validation endpoints auth/paiement/admin, HMAC QR, rate limiting, TRUSTED_PROXY_IPS |
| **Documentation** | Documentation technique | `docs/architecture.md`, `docs/valeurs-par-defaut.md`, `docs/contrat-api.yaml` |
| **Explore** | Audit du périmètre CDC | Analyse des gaps fonctionnels, identification des endpoints manquants |

---

*InsTRAM — Guide de déploiement — CODEL Technologies Co. — Confidentiel*
*Dernière mise à jour : Septembre 2026*
