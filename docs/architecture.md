# InsTRAM — Architecture Technique

Document de référence produit par l'agent Architecte. Une fois validé par le porteur de projet, il devient (avec `schema.prisma` et `docs/contrat-api.yaml`) la source de vérité technique du projet. Toute déviation par les agents backend, frontend, realtime, QA, DevOps, securite ou documentation doit être signalée explicitement.

---

## 0. Décisions techniques validées — 2026-08-31

Toutes les décisions ci-dessous ont été validées par le porteur de projet avec les valeurs par défaut proposées. Elles sont désormais **contraignantes** pour tous les agents d'implémentation.

| Ref | Sujet | Valeur retenue ✅ |
|---|---|---|
| VH-01 | Durée du hold provisoire d'un siège | 2 min (sélection) + 5 min (paiement) = **7 min max total** |
| VH-02 | Fenêtre de silence nocturne SMS (UTC+3 Madagascar) | **21h00 – 06h00** |
| VH-03 | Délai de clôture automatique d'un trajet | **72 heures** après l'heure de départ |
| VH-04 | Commission par défaut (nouvelle coopérative validée) | **8 %** par réservation en ligne confirmée |
| VH-05 | Frais de service voyageur (réservation en ligne) | **1 000 MGA fixe OU 3 %** (le plus élevé des deux) |
| VH-06 | Fournisseur SMS | Abstracteur `SmsProvider` — adaptateurs **Orange / Telma** |
| VH-07 | Agrégation Mobile Money | Interface `MobileMoneyGateway` — adaptateurs **MVola** et **Orange Money** (Airtel V2) |
| VH-08 | Rétention données personnelles après suppression compte | **Anonymisation immédiate** ; lignes financières conservées **10 ans** |
| VH-09 | Format QR code billet | **JSON signé HMAC** (bookingRef, tripInstanceId, seatCode, signature) |
| VH-10 | Devise | **MGA uniquement** en V1 |
| VH-11 | Catalogue villes / districts | Table `City` seedée — **~119 districts** nationaux malgaches |
| VH-12 | Politique mots de passe | **Argon2id, min 10 caractères** ; MFA optionnel pour les admins InsTRAM |
| VH-13 | Formats d'exports | **CSV UTF-8 + PDF** (manifeste) ; **XLSX** (rapport financier) |

Les agents backend, realtime, frontend, QA, DevOps et securite peuvent démarrer leurs implémentations.

---

## 1. Principes directeurs

1. **Zéro double réservation** : une place vendue disparaît instantanément pour tous les autres voyageurs. La règle est protégée à trois niveaux : contrainte d'unicité PostgreSQL, transaction avec `SELECT ... FOR UPDATE`, diffusion WebSocket immédiate.
2. **Souveraineté coopérative** : la coopérative fixe ses prix, horaires, catégories de sièges, politique d'annulation. InsTRAM ne les surcharge jamais côté application, il ne fait que les exposer aux voyageurs.
3. **Walk-in gratuit** : les réservations créées par le personnel coopérative sont marquées `channel = WALK_IN` et bypassent toute commission plateforme et frais de service voyageur, sans exception.
4. **Pas d'annulation dans l'app** : aucun endpoint `DELETE /bookings/{id}` côté voyageur. Le statut passe à `CANCELLED_AT_COUNTER` uniquement via un agent coopérative depuis le back-office.
5. **Temps réel obligatoire** : WebSocket sur les canaux `trip:{tripInstanceId}` pour la carte des sièges. Aucun polling (interdit par le cahier des charges).
6. **Frugalité réseau** : cible = téléphone Android d'entrée de gamme sur 3G lente. Réponses API paginées, compressées gzip/br, projections légères, images en WebP, JS bundle Next.js < 200 kB gzip pour le tunnel de réservation voyageur.
7. **Bilinguisme FR/MG** : toute chaîne exposée au voyageur ou à la coopérative existe en FR et MG. La console admin InsTRAM reste en FR uniquement (CDC §5.6).
8. **Traçabilité** : chaque action sensible (paiement, statut de billet, accès admin, modification tarif) est loggée dans `AuditLog`.

---

## 2. Vue d'ensemble des composants

```
                                    +------------------------------+
                                    |  Voyageur (mobile web, 3G)   |
                                    |  Coopérative (desktop)       |
                                    |  Conducteur (mobile web)     |
                                    |  Admin InsTRAM (desktop)     |
                                    +---------------+--------------+
                                                    |
                                                    | HTTPS (REST + SSE)
                                                    | WSS (WebSocket)
                                                    v
                        +---------------------------+---------------------------+
                        |                    Edge / CDN                          |
                        |          (TLS, gzip/br, cache statique Next.js)        |
                        +---------------------------+---------------------------+
                                                    |
                       +----------------------------+----------------------------+
                       |                                                         |
                       v                                                         v
        +--------------+--------------+                       +------------------+---------+
        |     Next.js Frontend        |                       |     Backend Node.js         |
        |  (App Router, SSR/ISR)      | <------ REST -------> |  (Fastify ou Express)       |
        |  i18n FR/MG                 |                       |  Domaines : auth, catalog,  |
        |  Service Worker (cache      |                       |  booking, payment, ops,     |
        |  read-only, aucune écriture |                       |  admin, notif, exports      |
        |  hors-ligne)                |                       +--------+---------+----------+
        +-------------+---------------+                                |         |
                      |                                                |         |
                      | WSS                                            |         |
                      v                                                |         |
        +-------------+---------------+                                |         |
        |  Serveur WebSocket          | <------ Redis Pub/Sub -------- +         |
        |  (canaux trip:{id},         |                                          |
        |  booking:{userId},          |                                          |
        |  cooperative:{id})          |                                          |
        +-------------+---------------+                                          |
                      |                                                          |
                      v                                                          v
                +-----+-----+                                       +------------+-----------+
                |   Redis   | <------ cache, sessions, locks -----> |     PostgreSQL 15+     |
                | (Pub/Sub, |                                       |   (schéma Prisma,      |
                |  cache,   |                                       |   FOR UPDATE locks,    |
                |  locks)   |                                       |   contraintes uniques) |
                +-----+-----+                                       +------------+-----------+
                      |                                                          |
                      |                                                          |
                      v                                                          v
        +-------------+---------------+                       +------------------+---------+
        |  Workers (BullMQ)           |                       |  Object Storage (S3-like)  |
        |  - SMS dispatch (silence)   |                       |  Exports CSV/PDF/XLSX,     |
        |  - Trip auto-close 72h      |                       |  logos coopératives, QR    |
        |  - Payment reconciliation   |                       +----------------------------+
        |  - Anonymisation RGPD-like  |
        |  - Génération exports       |
        +-------------+---------------+
                      |
        +-------------+---------------+---------------------------+
        |                             |                           |
        v                             v                           v
+-------+---------+          +--------+--------+         +--------+--------+
| Passerelle SMS  |          |  MVola API      |         | Orange Money API|
| (abstracteur)   |          |  (adapter)      |         | (adapter)       |
+-----------------+          +-----------------+         +-----------------+
```

### 2.1 Frontend Next.js

- App Router (Next.js 14+), rendu SSR pour la home / recherche (SEO annuaire public), ISR pour les fiches coopérative de l'annuaire, CSR pour le tunnel de réservation.
- i18n : segments `/fr/...` et `/mg/...`, catalogue de traductions JSON versionné.
- Service worker limité au cache read-only (images, statiques, réponses catalog). Aucune écriture hors-ligne : le CDC exige un mode temps réel.
- Trois espaces distincts, un seul monorepo Next.js :
  - `/` : espace voyageur + annuaire public
  - `/coop/*` : back-office coopérative
  - `/driver/*` : app conducteur (PWA, layout minimal, gros boutons, mode caméra scan)
  - `/admin/*` : console InsTRAM (FR only)

### 2.2 Backend Node.js

- Framework : Fastify recommandé (perf sur 3G, plugin natifs pour compression, rate-limit, JWT). Express acceptable si préférence d'équipe.
- Architecture en modules par domaine (voir §3).
- ORM : Prisma (voir `schema.prisma`). Aucune requête SQL brute sauf pour la logique de verrouillage siège (voir §5).
- Auth : JWT courts (15 min) + refresh token rotatif stocké dans `AuthSession`.
- Rate limiting par IP + par utilisateur, plus strict sur `/auth/*` et `/payments/*`.

### 2.3 Serveur WebSocket

- Process Node séparé (ou même process, plugin Fastify WebSocket), scalable horizontalement via Redis Pub/Sub.
- Canaux :
  - `trip:{tripInstanceId}` : diffusion des changements de statut de siège (`HELD`, `SOLD`, `RELEASED`)
  - `booking:{userId}` : notifications de réservation en cours (paiement confirmé, échec)
  - `cooperative:{cooperativeId}` : tableau de bord temps réel back-office
  - `driver:{tripInstanceId}` : app conducteur (embarquement scanné, absents)
- Authentification WS : token JWT court passé en query string à la connexion, revalidé côté serveur.
- Pas de fallback long-polling (CDC interdit). En cas de coupure WS, l'UI affiche un bandeau « reconnexion... » et refetch REST à la reconnexion.

### 2.4 PostgreSQL

- Version 15+.
- Schéma géré par Prisma migrate.
- Extensions attendues : `citext` (emails/telephones normalisés), `pg_trgm` (recherche annuaire coopératives), `pgcrypto` (UUID + hachage).
- Read replicas non requis en V1, prévoir séparation lecture/écriture pour V2 (annuaire public, exports).

### 2.5 Redis

- Rôles :
  - Pub/Sub inter-instances WS.
  - Cache court (60 s) sur résultats de recherche.
  - Verrous distribués pour le hold siège (double sécurité en amont du verrou PG).
  - Files BullMQ (SMS, exports, clôture automatique).
- Persistance AOF pour survivre à un redémarrage (les holds courts sont acceptables à perdre, mais pas les jobs SMS).

### 2.6 Passerelles externes

- **SMS** : interface `SmsProvider` avec méthodes `send(to, text, lang)`. Un ou plusieurs adaptateurs. Retry avec backoff (BullMQ). Respect strict de la plage de silence pour les notifications non transactionnelles.
- **Mobile Money** : interface `MobileMoneyGateway` avec méthodes `initiatePayment`, `verifyCallback`, `queryStatus`. Adaptateurs MVola et Orange Money.
  - Webhook entrant sur `/webhooks/mobile-money/{provider}` avec vérification signature.
  - Idempotence par `providerTransactionId` (contrainte unique en base).

### 2.7 Workers (BullMQ)

- `sms.dispatch` : envoi SMS + report si silence nocturne.
- `trip.autoClose` : marque `COMPLETED` les TripInstance après VH-03.
- `payment.reconcile` : requête statut opérateur pour paiements `PENDING` > 5 min.
- `booking.releaseHold` : libère les holds expirés (double garantie avec TTL Redis).
- `export.generate` : produit CSV/PDF/XLSX, stocke sur S3, notifie l'utilisateur.
- `rgpd.anonymize` : anonymise les comptes marqués supprimés.

---

## 3. Découpage en modules / domaines (backend)

```
backend/
  src/
    modules/
      auth/            # Login, refresh, invitation, MFA admin
      users/           # Profils, préférences langue, suppression RGPD-like
      catalog/         # Villes, routes, coopératives (référentiel)
      cooperatives/    # Back-office coop : membres, plans, politique
      vehicles/        # Véhicules, plans de sièges, catégories VIP/Premium/Classic/Standard
      trips/           # Routes, schedules, TripInstance, ouverture réservations
      seats/           # Disponibilité, holds, verrouillage, WebSocket events
      bookings/        # Réservations en ligne + walk-in, billets, QR
      payments/        # Mobile Money, webhooks, réconciliation, frais
      driver/          # Manifeste, scan embarquement, absents, départ
      admin/           # Validation coop, plans tarifaires, modération, supervision
      notifications/   # SMS, silence nocturne, i18n contenu
      ratings/         # Notes / avis coopératives, modération
      exports/         # Manifeste, rapport financier, jobs génération
      directory/       # Annuaire public coopératives (SSR/ISR)
      audit/           # AuditLog central
      i18n/            # Catalogue de traductions serveur (messages SMS, exports)
    infra/
      db/              # Prisma client, transactions, verrous
      cache/           # Redis client
      queue/           # BullMQ
      ws/              # WebSocket server
      sms/             # SmsProvider interface + adaptateurs
      mobileMoney/     # Gateway interface + adaptateurs
      storage/         # S3 client (exports, QR)
      logger/          # Pino, corrélation requêtes
      security/        # JWT, hachage, signatures QR
    api/
      v1/              # Routes REST versionnées
    ws/
      channels/        # Handlers WebSocket
```

### Dépendances (interdictions)

- `bookings` peut appeler `seats`, `payments`, `notifications`.
- `seats` ne dépend d'aucun autre module métier (feuille du graphe).
- `payments` ne dépend pas de `bookings` (les webhooks sont poussés vers `bookings` via des événements internes).
- `admin` peut lire tout, écrire dans `cooperatives`, `users`, `ratings` (modération).
- `driver` lit `bookings`, écrit `bookings.boardingStatus` uniquement.
- Aucun module frontend ne parle directement à la DB — tout passe par l'API v1.

---

## 4. Modèle de données — tour d'horizon

Le schéma détaillé est dans `schema.prisma`. Résumé des entités :

### Identité et rôles
- `User` : compte de base (email/tel), avec `preferredLang` (FR/MG).
- `TravelerProfile` : données voyageur (nom, prénom, téléphone Mobile Money).
- `Membership` : lien User <-> Cooperative avec rôle (`COOP_ADMIN`, `COOP_ASSISTANT`, `COOP_DRIVER`, `COOP_CONTROLLER`).
- `AdminProfile` : lien User <-> rôle InsTRAM (`ADMIN_SUPER`, `ADMIN_OPS`, `ADMIN_MODERATOR`).
- `AuthSession` : sessions/refresh tokens.
- `Invitation` : invitation d'un membre à une coopérative.

### Coopérative et flotte
- `Cooperative` : nom, statut de validation, logo, plan tarifaire, politique d'annulation, note moyenne.
- `CooperativePricingPlan` : COMMISSION (%) ou SUBSCRIPTION (mensuel), historisé.
- `CooperativeSubscription` : facture d'abonnement suivie manuellement (CDC 4.2 : suivi manuel V1).
- `Vehicle` : véhicule, immatriculation, capacité, plan de sièges associé.
- `SeatMap` : plan géométrique (schéma JSON) réutilisable entre véhicules.
- `SeatDefinition` : position, code (ex. 12A), catégorie (`VIP`, `PREMIUM`, `CLASSIC`, `STANDARD`).

### Routes et trajets
- `City` : catalogue national (nom FR/MG, district, région, geopoint optionnel).
- `Route` : `originCityId`, `destinationCityId`, `cooperativeId`, distance estimée, durée estimée.
- `RouteStop` : arrêts intermédiaires (facultatif).
- `Schedule` : gabarit récurrent (jour de semaine, heure de départ, route, vehicle type).
- `TripInstance` : instance datée d'un Schedule, avec `vehicleId`, `departureAt`, `status`, `openedForBookingAt`.
- `Fare` : prix par catégorie de siège pour un TripInstance (souverain coopérative).

### Réservations et sièges (coeur zéro double réservation)
- `SeatHold` : hold provisoire (userId ou walk-in staffId), avec `expiresAt`, `tripInstanceId`, `seatDefinitionId`.
- `Booking` : réservation confirmée, `channel` (`ONLINE` ou `WALK_IN`), `status`, `reference` courte lisible (ex. `IT-A7X9B`), `qrPayload`, `boardingStatus`.
- `BookingSeat` : lignes siège <-> booking, contrainte unique `(tripInstanceId, seatDefinitionId)` avec index partiel sur bookings non-annulés.
- `Passenger` : info du passager (peut être différent du user).

### Paiement
- `Payment` : `bookingId`, `provider` (MVOLA, ORANGE_MONEY, CASH), `amount`, `currency` (MGA), `status`, `providerTransactionId` unique, `initiatedAt`, `confirmedAt`.
- `PlatformFee` : frais de service voyageur appliqué (0 pour walk-in).
- `Commission` : commission plateforme prélevée (0 pour walk-in ou plan SUBSCRIPTION).

### Opérations conducteur
- `BoardingEvent` : embarquement scanné, avec `driverId`, `bookingId`, `at`, `method` (`SCAN`, `MANUAL_REF`).
- `AbsenceEvent` : passager marqué absent.
- `TripDepartureEvent` : signalement du départ effectif.

### Notifications
- `Notification` : destinataire, canal (SMS, PUSH, EMAIL), template, payload, `lang`, `status`, `scheduledFor` (pour report silence nocturne), `sentAt`.
- `NotificationTemplate` : template bilingue FR/MG, versionné.

### Notation / annuaire
- `Rating` : note 1-5 + commentaire, `bookingId` unique (une note par voyage), statut de modération.
- `DirectoryEntry` : cache dénormalisé pour l'annuaire public (SEO).

### Exports et audit
- `ExportJob` : type, filtres, `status`, `resultUrl`, `requestedBy`.
- `AuditLog` : action, acteur, entité, avant/après, IP, userAgent.

### Souveraineté et internationalisation
- `CooperativePolicy` : texte bilingue de la politique d'annulation propre à la coopérative, affiché avant paiement.

---

## 5. Zéro double réservation — mécanisme détaillé

C'est la règle la plus critique. Elle est protégée à quatre niveaux :

### 5.1 Niveau UI (Next.js + WebSocket)
- À l'ouverture de la carte des sièges, le client s'abonne à `trip:{tripInstanceId}`.
- Chaque évènement `SEAT_HELD`, `SEAT_SOLD`, `SEAT_RELEASED` met à jour l'état visuel < 200 ms.
- Un siège en `HELD` par un autre utilisateur est grisé (non cliquable).
- Aucune requête de sélection n'est acceptée si le WS n'est pas connecté (bandeau bloquant).

### 5.2 Niveau API (transaction PostgreSQL)
- L'endpoint `POST /v1/trips/{id}/seats/hold` exécute :
  ```
  BEGIN;
    SELECT id FROM "SeatDefinition"
      WHERE id = $seatId
      FOR UPDATE;

    -- Vérifie qu'il n'existe pas déjà :
    -- (a) un BookingSeat actif sur (tripInstanceId, seatDefinitionId)
    -- (b) un SeatHold non expiré sur (tripInstanceId, seatDefinitionId)

    INSERT INTO "SeatHold" (...) ...;
  COMMIT;
  ```
- En cas de conflit, l'API renvoie `409 SEAT_UNAVAILABLE`.
- La contrainte d'unicité en base garantit qu'aucune insertion parallèle ne peut réussir même si le verrou est court-circuité.

### 5.3 Niveau base de données (contraintes)
- Index unique partiel :
  ```sql
  CREATE UNIQUE INDEX "uniq_active_booking_seat"
    ON "BookingSeat" ("tripInstanceId", "seatDefinitionId")
    WHERE "isActive" = true;

  CREATE UNIQUE INDEX "uniq_active_seat_hold"
    ON "SeatHold" ("tripInstanceId", "seatDefinitionId")
    WHERE "expiresAt" > NOW();
  ```
- Ces index sont la source de vérité ultime. Le code peut avoir un bug ; la DB ne laissera jamais deux réservations sur le même couple.

### 5.4 Niveau cache (Redis, verrou avancé)
- Avant d'entrer dans la transaction PG, on prend un verrou Redis `lock:seat:{tripInstanceId}:{seatDefinitionId}` avec `SET NX PX 3000`.
- Ce verrou évite l'attente sur la file PG en cas de forte concurrence et permet un rejet rapide côté API sur les téléphones lents.
- Le verrou Redis est un accélérateur, jamais la source de vérité.

### 5.5 Confirmation (paiement confirmé)
- À réception du webhook Mobile Money, `Payment.status = CONFIRMED` déclenche :
  ```
  BEGIN;
    -- Convertit SeatHold -> BookingSeat actif
    -- Marque Booking.status = CONFIRMED
    -- Émet WS SEAT_SOLD à trip:{tripInstanceId}
    -- Enfile SMS confirmation (immédiat, hors silence)
  COMMIT;
  ```
- Si le paiement expire ou échoue, le SeatHold est laissé expirer (worker `booking.releaseHold`) et un event `SEAT_RELEASED` est diffusé.

### 5.6 Walk-in
- Le personnel coopérative crée directement une `Booking` avec `channel = WALK_IN`, `status = CONFIRMED`. Même transaction, mêmes contraintes, mais `PlatformFee = 0` et `Commission = 0`.
- Le paiement est enregistré avec `provider = CASH` ou `MVOLA`/`ORANGE_MONEY` selon le cas, mais aucun frais plateforme n'est facturé.

---

## 6. Flux de données principaux

### 6.1 Recherche voyageur
1. `GET /v1/search/trips?originCityId=...&destinationCityId=...&date=YYYY-MM-DD&lang=fr`
2. Cache Redis 60 s sur la clé `(origin, destination, date)`.
3. Réponse paginée légère : liste de `TripInstance` avec `fareMin`, `fareMax`, `seatsAvailable`, `cooperative { id, name, rating }`.
4. Payload cible < 20 kB gzip pour 20 résultats.

### 6.2 Sélection siège + hold
1. `GET /v1/trips/{id}/seats` → carte des sièges (état + prix par catégorie).
2. Ouverture WS `trip:{id}`.
3. `POST /v1/trips/{id}/seats/hold { seatDefinitionIds: [...] }` → crée les holds, TTL VH-01 (2 min).
4. Diffusion WS `SEAT_HELD` aux autres clients.

### 6.3 Paiement Mobile Money
1. `POST /v1/bookings { holdId, passenger, paymentMethod: MVOLA }` → crée `Booking` en `PENDING_PAYMENT`, prolonge le hold à VH-01 (7 min total).
2. Backend appelle `MobileMoneyGateway.initiatePayment` → renvoie une instruction (push USSD, code à composer).
3. Webhook opérateur → `Payment.status = CONFIRMED` → `Booking.status = CONFIRMED`, WS `SEAT_SOLD`, SMS envoyé immédiatement (bypass silence).
4. Si timeout : `Booking.status = PAYMENT_EXPIRED`, hold libéré, WS `SEAT_RELEASED`.

### 6.4 Walk-in
1. Agent coopérative connecté (Membership `COOP_ASSISTANT` ou `COOP_ADMIN`).
2. `POST /v1/coop/bookings/walk-in { tripInstanceId, seatDefinitionIds, passenger, paymentMethod }`.
3. Booking créé directement `CONFIRMED`, `channel = WALK_IN`, aucun frais plateforme.
4. WS `SEAT_SOLD` diffusé, SMS billet envoyé au passager si téléphone fourni.

### 6.5 Embarquement conducteur
1. Conducteur connecté (Membership `COOP_DRIVER`), `GET /v1/driver/trips/today`.
2. `GET /v1/driver/trips/{id}/manifest` → liste passagers.
3. `POST /v1/driver/trips/{id}/board { bookingReference OU qrPayload }` → vérifie signature, marque `BoardingEvent`.
4. WS `driver:{tripInstanceId}` mis à jour temps réel (utile si plusieurs contrôleurs).
5. `POST /v1/driver/trips/{id}/depart` → signale départ effectif.
6. `POST /v1/driver/trips/{id}/no-show { bookingId }` → marque absent après départ.

### 6.6 Clôture automatique
Worker `trip.autoClose` : toutes les 10 min, marque `COMPLETED` les `TripInstance` dont `departureAt < NOW() - VH-03` et qui ne sont pas `CANCELLED`.

### 6.7 Notation
1. Après `COMPLETED`, event interne → `POST /v1/ratings { bookingId, score, comment }` autorisé au voyageur pendant 30 jours.
2. Modération admin : `PATCH /v1/admin/ratings/{id} { status }`.

### 6.8 Notifications SMS
1. Un événement métier enfile un job `sms.dispatch { userId, template, params, lang }`.
2. Worker : si transactionnel (paiement, billet, annulation faite au guichet), envoi immédiat.
3. Sinon, si dans plage silence VH-02, `scheduledFor = prochain 06h00 locale`.
4. Appel `SmsProvider.send` avec template rendu dans `lang` du destinataire.

### 6.9 Exports
1. `POST /v1/coop/exports { type: MANIFEST | FINANCIAL_REPORT, filters }` → crée `ExportJob`.
2. Worker `export.generate` produit le fichier, l'upload sur S3, `resultUrl` signé 24 h.
3. Notification au demandeur (in-app + SMS optionnel).

### 6.10 Suppression compte voyageur (RGPD-like)
1. `DELETE /v1/me` → marque `User.deletionRequestedAt`.
2. Worker `rgpd.anonymize` : anonymise `TravelerProfile`, garde `Booking` et `Payment` avec référence anonyme.
3. Fait dans la transaction : purge des `AuthSession`, révocation immédiate des JWT (blocklist Redis).

---

## 7. Contraintes non fonctionnelles

### 7.1 Performance sur 3G lente
- Réponses API compressées br/gzip obligatoires.
- Pagination systématique (`limit` max 50, défaut 20).
- Projections : jamais renvoyer d'objet complet quand un DTO suffit.
- Cache HTTP `Cache-Control` : 60 s sur recherche, 5 min sur annuaire, `no-store` sur booking/payment.
- Next.js : bundle voyageur < 200 kB gzip ; images en WebP responsives ; polices système en priorité.
- Interdiction d'un carrousel d'images sur la home voyageur (poids).

### 7.2 Résilience
- Retry avec backoff exponentiel sur SMS et Mobile Money (BullMQ).
- Circuit breaker sur les passerelles externes.
- Timeouts stricts (5 s pour Mobile Money init, 30 s pour webhook confirmation).

### 7.3 Bilinguisme FR/MG
- `User.preferredLang` enum `FR | MG`.
- Frontend : segments `/fr/*`, `/mg/*`, détection langue navigateur, switcher persistant.
- Backend : les endpoints acceptent `Accept-Language` pour rendre les messages d'erreur, sinon `lang` en query.
- Templates SMS et exports générés dans la langue destinataire.
- Console admin InsTRAM : FR uniquement (CDC §5.6).

### 7.4 Sécurité
- TLS 1.2+ obligatoire (edge).
- JWT signés HS256 (secret rotatif), payload minimal (userId, roles).
- Refresh token rotatif, one-time-use, stocké haché en base.
- Rate limit : `/auth/login` 5 req / 15 min / IP, `/payments/*` 30 req / min / user.
- Webhooks Mobile Money : vérification signature obligatoire, rejet en < 5 s si invalide.
- CSP stricte côté Next.js (pas de `unsafe-eval`).
- QR code du billet : payload signé HMAC, revalidé côté conducteur.
- Audit log immuable (append-only) sur : paiements, changements de statut billet, accès admin, modification tarif coopérative.

### 7.5 Disponibilité
- Cible V1 : 99.5 % mensuel.
- Health checks `/healthz` (liveness) et `/readyz` (readiness).
- Sauvegarde PG quotidienne + PITR 7 jours.
- Deploy blue/green pour le backend et Next.js.

### 7.6 Observabilité
- Logs Pino JSON, corrélation par `traceId`.
- Métriques Prometheus : latence API par route, taux d'erreurs, holds actifs, taux de conversion booking, latence Mobile Money.
- Dashboards Grafana : disponibilité par trajet, temps de résolution paiement.

### 7.7 Versionnement API
- Toutes les routes préfixées `/v1/`.
- Toute évolution incompatible (V2) sans casser V1 pendant au moins 6 mois.
- Les entités « ouvertes vers le futur » (GPS, abonnements voyageur, API tierce) sont déjà présentes en base avec des flags `null`, pas de nouvelle table nécessaire à V2 pour ces cas :
  - `Vehicle.gpsDeviceId` (nullable) — hook GPS futur.
  - `TravelerSubscription` (table présente mais désactivée) — pass multi-trajets futur.
  - `ApiClient` (table présente) — clés API tierces futures.

---

## 8. Diagramme de dépendances (composants runtime)

```
Frontend Next.js  --REST-->  Backend API  --Prisma-->  PostgreSQL
       |                          |
       |                          +--BullMQ-->  Workers  --HTTP-->  SMS Provider
       |                          |                     --HTTP-->  Mobile Money
       |                          |
       |                          +--Redis-->  Cache + Locks
       |
       +--WSS-->  WebSocket Server  --Redis Pub/Sub-->  Backend API

Backend API  <--Webhook--  Mobile Money Provider
Backend API  --S3-->  Object Storage (exports, QR PNG optionnel)
```

Dépendances de démarrage (ordre) :
1. PostgreSQL
2. Redis
3. Backend API + WebSocket
4. Workers
5. Next.js (SSR appelle Backend API en interne)

---

## 9. Règles de gestion critiques (rappel exhaustif)

Chaque règle est référencée dans les tests QA.

| Ref | Règle | Localisation code |
|---|---|---|
| RG-01 | Zéro double réservation | `seats`, DB constraints |
| RG-02 | Walk-in gratuit | `bookings.createWalkIn`, `PlatformFee`, `Commission` |
| RG-03 | Pas d'annulation dans l'app | Absence d'endpoint DELETE `/bookings`, uniquement `/coop/bookings/{id}/cancel-at-counter` |
| RG-04 | Souveraineté prix / horaires | Aucune validation InsTRAM sur `Fare` ou `Schedule` |
| RG-05 | Silence nocturne SMS | Worker `sms.dispatch`, timezone Madagascar UTC+3 |
| RG-06 | Clôture auto après VH-03 | Worker `trip.autoClose` |
| RG-07 | Bilinguisme voyageur + coop | i18n obligatoire sur toutes vues sauf `/admin/*` |
| RG-08 | Anonymisation immédiate suppression compte | Worker `rgpd.anonymize` déclenché sur `DELETE /v1/me` |
| RG-09 | Vert #9CC43D réservé transactionnel | Charte CSS, revue frontend obligatoire |
| RG-10 | Pas de polling, WebSocket obligatoire | Interdiction lint `setInterval` sur endpoints seats/bookings |
| RG-11 | Notation possible après voyage uniquement | Contrôle `Booking.status = COMPLETED` avant `POST /v1/ratings` |
| RG-12 | Une note par voyage | Contrainte unique `Rating.bookingId` |
| RG-13 | Traçabilité actions sensibles | `AuditLog` obligatoire dans `payments`, `admin`, `bookings.cancel-at-counter` |

---

## 10. Ouverture V2 (architecturalement préservée, non implémentée)

Ces éléments ne sont pas dans le périmètre V1 (CDC §4.2), mais l'architecture ne les ferme pas :

- **GPS temps réel** : colonne `Vehicle.gpsDeviceId` + canal WS `vehicle:{id}` prévu.
- **Abonnements voyageur / pass** : table `TravelerSubscription` en base avec flag `enabled = false`.
- **API tierce (agences)** : table `ApiClient` + endpoints `/v1/partner/*` réservés (non exposés en V1).
- **Airtel Money** : ajouter un adaptateur `MobileMoneyGateway` sans changer le contrat.
- **Facturation automatique abonnements coopérative** : le champ `CooperativeSubscription.status` accepte déjà `AUTO_BILLED` en plus de `MANUAL`.

---

## 11. Prochaines étapes (pour les agents suivants)

1. **Backend** : implémenter `schema.prisma`, module `seats` avec la stratégie de verrouillage §5, module `bookings`, module `payments`.
2. **Realtime** : serveur WebSocket, canaux définis §2.3, intégration Redis Pub/Sub.
3. **Frontend** : shell Next.js, i18n FR/MG, tunnel de réservation, back-office coopérative, app conducteur, console admin.
4. **QA** : rejouer les 13 règles de gestion §9, campagne de charge sur la sélection de siège concurrente.
5. **DevOps** : docker-compose local (PG + Redis + backend + WS + workers + Next.js), pipeline CI, environnements staging/prod.
6. **Sécurité** : revue JWT / webhook / QR, checklist OWASP Top 10, audit RGPD-like.
7. **Documentation** : guide de déploiement, procédures de secours, guide utilisateur voyageur / coopérative / conducteur / admin (FR + MG pour les trois premiers).

Aucun agent d'implémentation ne démarre avant validation humaine des 13 points §0.
