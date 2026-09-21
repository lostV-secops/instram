# InsTRAM — Plan de tests et scénarios de validation

| Champ | Valeur |
|---|---|
| Projet | InsTRAM |
| Version | 1.0 — Septembre 2026 |
| Source | CDC §4.1, §5.x, §7, valeurs-par-defaut.md (VH-01..VH-13) |

---

## Vue d'ensemble

Ce document couvre l'ensemble des scénarios à valider pour chaque livrable du CDC §11 et chaque fonctionnalité demandée par le product owner. Chaque scénario précise le rôle utilisateur, les préconditions, les étapes, le résultat attendu et le fichier de test automatisé correspondant.

### Légende statuts

| Statut | Signification |
|---|---|
| ✅ Couvert | Test automatisé existant dans `frontend/e2e/` |
| 🆕 Nouveau | Test ajouté dans cette session |
| ⚙️ API | Test au niveau HTTP (pas de UI) |
| 📋 Manuel | Scénario à valider manuellement (ex : SMS réel, paiement Mobile Money) |

---

## I — Livrables CDC §11

### L1 · Application web voyageur

| # | Scénario | Fichier | Statut |
|---|---|---|---|
| L1-01 | Page d'accueil charge sans erreur en FR et MG | `01-home-search.spec.ts` | ✅ |
| L1-02 | Recherche trajet par ville départ / arrivée / date | `01-home-search.spec.ts` | ✅ |
| L1-03 | Résultats de recherche listent les trajets disponibles | `07-booking.spec.ts` | ✅ |
| L1-04 | Page de détail d'un trajet accessible sans connexion | `07-booking.spec.ts` | ✅ |
| L1-05 | Carte des sièges affichée avec statuts AVAILABLE / OCCUPIED | `07-booking.spec.ts` | ✅ |
| L1-06 | Hold d'un siège crée un token de 7 minutes | `17-business-rules.spec.ts` | 🆕 |
| L1-07 | Formulaire de réservation affiche champs passager | `07-booking.spec.ts` | ✅ |
| L1-08 | Choix moyen de paiement MVola / Orange Money | `07-booking.spec.ts` | ✅ |
| L1-09 | Billet numérique consultable après confirmation | `14-profile.spec.ts` | 🆕 |
| L1-10 | Page liste des réservations voyageur | `06-authenticated.spec.ts` | ✅ |
| L1-11 | Redirection vers login si accès à /bookings non connecté | `06-authenticated.spec.ts` | ✅ |

### L2 · Back-office coopérative

| # | Scénario | Fichier | Statut |
|---|---|---|---|
| L2-01 | Accès /coop interdit sans rôle COOP | `08-coop-backoffice.spec.ts` | ✅ |
| L2-02 | Dashboard charge pour COOP_ADMIN | `08-coop-backoffice.spec.ts` | ✅ |
| L2-03 | Création d'une route (origine → destination) | `08-coop-backoffice.spec.ts` | ✅ |
| L2-04 | Création d'un trajet (route + véhicule + horaire) | `08-coop-backoffice.spec.ts` | ✅ |
| L2-05 | Liste des réservations back-office | `08-coop-backoffice.spec.ts` | ✅ |
| L2-06 | Walk-in : formulaire guichet accessible | `08-coop-backoffice.spec.ts` | ✅ |
| L2-07 | Walk-in : réservation cash sans frais de service | `10-walkin.spec.ts` | 🆕 |
| L2-08 | Gestion des membres (liste + invitation) | `08-coop-backoffice.spec.ts` | ✅ |
| L2-09 | Modification des paramètres coopérative | `08-coop-backoffice.spec.ts` | ✅ |
| L2-10 | Gestion des tarifs par trajet | `08-coop-backoffice.spec.ts` | ✅ |
| L2-11 | Export manifeste CSV + PDF | `15-exports.spec.ts` | 🆕 |
| L2-12 | Export rapport financier XLSX | `15-exports.spec.ts` | 🆕 |
| L2-13 | Annulation d'un trajet DRAFT (sans réservations confirmées) | `10-walkin.spec.ts` | 🆕 |
| L2-14 | Politique d'annulation bilingue FR/MG éditable | `08-coop-backoffice.spec.ts` | ✅ |
| L2-15 | Désactivation d'un membre | `10-walkin.spec.ts` | 🆕 |

### L3 · Application conducteur

| # | Scénario | Fichier | Statut |
|---|---|---|---|
| L3-01 | Accès /driver interdit sans rôle DRIVER | `11-driver-app.spec.ts` | 🆕 |
| L3-02 | Liste des trajets du jour pour le conducteur | `11-driver-app.spec.ts` | 🆕 |
| L3-03 | Manifeste passagers d'un trajet | `11-driver-app.spec.ts` | 🆕 |
| L3-04 | Validation billet QR valide → embarquement confirmé | `11-driver-app.spec.ts` | 🆕 |
| L3-05 | QR invalide / falsifié → rejet avec message d'erreur | `11-driver-app.spec.ts` | 🆕 |
| L3-06 | Saisie manuelle référence courte (fallback scan) | `11-driver-app.spec.ts` | 🆕 |
| L3-07 | Marquer passager absent après départ | `11-driver-app.spec.ts` | 🆕 |
| L3-08 | Signaler le départ effectif du véhicule | `11-driver-app.spec.ts` | 🆕 |

### L4 · Console d'administration InsTRAM

| # | Scénario | Fichier | Statut |
|---|---|---|---|
| L4-01 | Accès /admin interdit sans rôle ADMIN | `12-admin-console.spec.ts` | 🆕 |
| L4-02 | Dashboard admin : liste des coopératives | `12-admin-console.spec.ts` | 🆕 |
| L4-03 | Validation d'une coopérative PENDING → VALIDATED | `12-admin-console.spec.ts` | 🆕 |
| L4-04 | Suspension d'une coopérative (SUSPENDED) | `12-admin-console.spec.ts` | 🆕 |
| L4-05 | Attribution d'un plan tarifaire (commission / abonnement) | `12-admin-console.spec.ts` | 🆕 |
| L4-06 | Liste des paiements de plateforme | `12-admin-console.spec.ts` | 🆕 |
| L4-07 | Modération des avis (masquer / valider) | `13-ratings.spec.ts` | 🆕 |
| L4-08 | Catalogue des villes : ajout d'une ville | `12-admin-console.spec.ts` | 🆕 |
| L4-09 | Journal d'audit — actions tracées | `12-admin-console.spec.ts` | 🆕 |

### L5 · Documentation de mise en production

| # | Scénario | Fichier | Statut |
|---|---|---|---|
| L5-01 | `docs/guide-deploiement.md` présent et complet | Manuel | ✅ |
| L5-02 | `backend/.env.example` couvre toutes les variables | Manuel | ✅ |
| L5-03 | Health check `/healthz` répond `{"status":"ok"}` | `17-business-rules.spec.ts` | 🆕 |
| L5-04 | `GET /api/health` frontend répond 200 | `17-business-rules.spec.ts` | 🆕 |
| L5-05 | Migration `npx prisma migrate deploy` s'applique sans erreur | Manuel | 📋 |
| L5-06 | Image Docker prod backend < 200 Mo | Manuel | 📋 |

### L6 · Spécification d'interface (contrat API)

| # | Scénario | Fichier | Statut |
|---|---|---|---|
| L6-01 | `docs/contrat-api.yaml` parseable (OpenAPI 3 valide) | Manuel | ✅ |
| L6-02 | Chaque endpoint documenté répond au schéma défini | `17-business-rules.spec.ts` | 🆕 |
| L6-03 | Réponses d'erreur suivent le format `{error, code, statusCode}` | `17-business-rules.spec.ts` | 🆕 |

---

## II — Fonctionnalités par profil utilisateur (CDC §5)

### §5.1 · Voyageur

| # | Scénario | Règle CDC | Fichier | Statut |
|---|---|---|---|---|
| V-01 | Recherche sans connexion possible | §5.1 | `01-home-search.spec.ts` | ✅ |
| V-02 | Comparaison résultats : prix, horaire, note coop | §5.1 | `07-booking.spec.ts` | ✅ |
| V-03 | Politique de la coopérative consultable avant achat | §5.1 | `07-booking.spec.ts` | ✅ |
| V-04 | Sélection visuelle de siège (carte 2D) | §5.1 | `07-booking.spec.ts` | ✅ |
| V-05 | Paiement MVola déclenche webhook → confirmation | §5.1 | 📋 |
| V-06 | Paiement Orange Money déclenche webhook → confirmation | §5.1 | 📋 |
| V-07 | Billet reçu immédiatement (hors plage silence) | §5.5 | 📋 |
| V-08 | Pas de bouton "Annuler" dans l'application voyageur | §7 | `07-booking.spec.ts` | 🆕 |
| V-09 | Page /bookings affiche historique complet | §5.1 | `06-authenticated.spec.ts` | ✅ |
| V-10 | Notation coopérative visible après voyage terminé | §5.1 | `13-ratings.spec.ts` | 🆕 |
| V-11 | Frais de service affichés avant confirmation (max 1000 MGA / 3%) | VH-05 | `07-booking.spec.ts` | 🆕 |

### §5.2 · Coopérative

| # | Scénario | Règle CDC | Fichier | Statut |
|---|---|---|---|---|
| C-01 | Création libre d'une route (pas de validation InsTRAM) | §5.2 | `08-coop-backoffice.spec.ts` | ✅ |
| C-02 | Définition des catégories de sièges VIP/Premium/Classic/Standard | §5.2 | `10-walkin.spec.ts` | 🆕 |
| C-03 | Horaires et prix modifiables uniquement pour trajets DRAFT | §5.2 | `17-business-rules.spec.ts` | 🆕 |
| C-04 | Walk-in sans frais (commission = 0) | §7 | `10-walkin.spec.ts` | 🆕 |
| C-05 | Tableau de bord KPIs : revenus nets, taux de remplissage | §5.2 | `08-coop-backoffice.spec.ts` | ✅ |
| C-06 | Invitation d'un conducteur par téléphone | §5.2 | `08-coop-backoffice.spec.ts` | ✅ |
| C-07 | COOP_ASSISTANT ne peut pas modifier les paramètres | §5.2 | `10-walkin.spec.ts` | 🆕 |
| C-08 | PATCH /coop/cooperatives/current met à jour les infos | — | `17-business-rules.spec.ts` | 🆕 |

### §5.3 · Conducteur / Contrôleur

| # | Scénario | Règle CDC | Fichier | Statut |
|---|---|---|---|---|
| D-01 | Accès à la liste de ses trajets (pas ceux des autres) | §5.3 | `11-driver-app.spec.ts` | 🆕 |
| D-02 | Scan QR → statut BOARDED mis à jour en base | §5.3 | `11-driver-app.spec.ts` | 🆕 |
| D-03 | Référence courte 8 chars acceptée à la place du QR | §5.3 | `11-driver-app.spec.ts` | 🆕 |
| D-04 | Passager déjà embarqué → alerte doublon | §5.3 | `11-driver-app.spec.ts` | 🆕 |
| D-05 | Passager absent marqué → statut NO_SHOW | §5.3 | `11-driver-app.spec.ts` | 🆕 |
| D-06 | Départ enregistré → statut trajet → IN_PROGRESS | §5.3 | `11-driver-app.spec.ts` | 🆕 |

### §5.4 · Administration InsTRAM

| # | Scénario | Règle CDC | Fichier | Statut |
|---|---|---|---|---|
| A-01 | Coopérative PENDING → VALIDATED par admin | §5.4 | `12-admin-console.spec.ts` | 🆕 |
| A-02 | Coopérative VALIDATED → SUSPENDED par admin | §5.4 | `12-admin-console.spec.ts` | 🆕 |
| A-03 | Plan commission 8% appliqué par défaut | VH-04 | `12-admin-console.spec.ts` | 🆕 |
| A-04 | Modération avis : masquer avis abusif | §5.4 | `13-ratings.spec.ts` | 🆕 |
| A-05 | Supervision paiements : liste de toutes les transactions | §5.4 | `12-admin-console.spec.ts` | 🆕 |
| A-06 | Vue globale trajets toutes coopératives | §5.4 | `12-admin-console.spec.ts` | 🆕 |

### §5.5 · Notifications

| # | Scénario | Règle CDC | Fichier | Statut |
|---|---|---|---|---|
| N-01 | SMS de confirmation envoyé immédiatement (hors silence) | §5.5 | 📋 |
| N-02 | SMS respect silence nocturne 21h–06h (différé) | VH-02 | `16-notifications.spec.ts` | 🆕 |
| N-03 | SMS d'annulation envoyé même pendant la nuit | §5.5 | `16-notifications.spec.ts` | 🆕 |
| N-04 | Rappel J-1 envoyé si `reminderSentAt` nul | §5.5 | `16-notifications.spec.ts` | 🆕 |
| N-05 | Contenu SMS dans la langue préférée du destinataire | §5.5 | `16-notifications.spec.ts` | 🆕 |

### §5.6 · Multilinguisme

| # | Scénario | Règle CDC | Fichier | Statut |
|---|---|---|---|---|
| ML-01 | /fr/... affiche contenu en français | §5.6 | `03-language-switch.spec.ts` | ✅ |
| ML-02 | /mg/... affiche contenu en malgache | §5.6 | `03-language-switch.spec.ts` | ✅ |
| ML-03 | Bascule langue persistée en cookie / préférence profil | §5.6 | `03-language-switch.spec.ts` | ✅ |
| ML-04 | Traductions manquantes ne font pas planter la page | §5.6 | `03-language-switch.spec.ts` | ✅ |
| ML-05 | Console admin reste en français uniquement | §5.6 | `12-admin-console.spec.ts` | 🆕 |
| ML-06 | Politique coopérative affiche les deux langues | §5.6 | `08-coop-backoffice.spec.ts` | ✅ |

---

## III — Règles de gestion et valeurs par défaut (VH-01..VH-13)

| ID | Règle | Scénario | Fichier | Statut |
|---|---|---|---|---|
| VH-01 | Hold siège = 7 min max (2 min sélection + 5 min paiement) | Hold expire → siège redevient AVAILABLE | `17-business-rules.spec.ts` | 🆕 |
| VH-02 | Silence SMS 21h–06h Madagascar (UTC+3) | Notification différée hors plage critique | `16-notifications.spec.ts` | 🆕 |
| VH-03 | Auto-close trajet 72h après départ prévu | TripInstance passe à COMPLETED automatiquement | `17-business-rules.spec.ts` | 🆕 |
| VH-04 | Commission 8% par défaut, modifiable par coopérative | Calcul commission sur une réservation confirmée | `17-business-rules.spec.ts` | 🆕 |
| VH-05 | Frais voyageur = max(1 000 MGA, 3% du billet) | Vérification calcul sur billet 10 000 MGA et 50 000 MGA | `17-business-rules.spec.ts` | 🆕 |
| VH-06 | SMS via Orange MG ou Telma (adaptateur) | Provider `stub` en test, `orange` en prod | `16-notifications.spec.ts` | 🆕 |
| VH-07 | Paiement MVola + Orange Money en V1 | Webhook reçu → réservation CONFIRMED | 📋 |
| VH-08 | Anonymisation immédiate à la suppression de compte | Données personnelles supprimées, paiements conservés | `14-profile.spec.ts` | 🆕 |
| VH-09 | QR = JSON HMAC-signé (ref + tripId + siège + signature) | QR falsifié avec mauvaise signature rejeté | `11-driver-app.spec.ts` | 🆕 |
| VH-10 | Devise MGA uniquement | Toute valeur retournée est en MGA | `17-business-rules.spec.ts` | 🆕 |
| VH-11 | 119 districts malgaches dans le catalogue | GET /catalog/cities renvoie ≥ 119 villes | `17-business-rules.spec.ts` | 🆕 |
| VH-12 | Mot de passe Argon2id, 10 caractères minimum | Inscription avec 9 chars rejetée | `02-auth.spec.ts` (existant à compléter) | 🆕 |
| VH-13 | Exports : manifeste CSV+PDF, rapports XLSX | Header Content-Type correct pour chaque format | `15-exports.spec.ts` | 🆕 |

---

## IV — Tests de sécurité (CDC §9.2)

| # | Scénario | Fichier | Statut |
|---|---|---|---|
| S-01 | Endpoint admin inaccessible avec token voyageur | `17-business-rules.spec.ts` | 🆕 |
| S-02 | Endpoint coop inaccessible sans rôle COOP | `08-coop-backoffice.spec.ts` | ✅ |
| S-03 | Token JWT expiré → 401 avec message approprié | `17-business-rules.spec.ts` | 🆕 |
| S-04 | Webhook Mobile Money sans HMAC valide → 401 | `17-business-rules.spec.ts` | 🆕 |
| S-05 | QR signé avec mauvaise clé QR_SECRET → rejet | `11-driver-app.spec.ts` | 🆕 |
| S-06 | Rate limit sur POST /auth/login (≥ 10 tentatives) | `17-business-rules.spec.ts` | 🆕 |
| S-07 | Suppression compte → données anonymisées, log conservé | `14-profile.spec.ts` | 🆕 |
| S-08 | CORS : requête depuis domaine non autorisé bloquée | `17-business-rules.spec.ts` | 🆕 |
| S-09 | Mot de passe 9 chars rejeté à l'inscription | `02-auth.spec.ts` | 🆕 |

---

## V — Tests temps réel (WebSocket — CDC §4.1)

| # | Scénario | Fichier | Statut |
|---|---|---|---|
| RT-01 | Connexion WebSocket établie sur `/ws` | `18-realtime.spec.ts` | 🆕 |
| RT-02 | Siège pris par utilisateur A disparaît pour utilisateur B (< 500 ms) | `18-realtime.spec.ts` | 🆕 |
| RT-03 | Hold expiré → siège redevient AVAILABLE en temps réel | `18-realtime.spec.ts` | 🆕 |
| RT-04 | Reconnexion WebSocket après coupure réseau | `18-realtime.spec.ts` | 🆕 |
| RT-05 | Événement `seat:updated` bien reçu côté client | `18-realtime.spec.ts` | 🆕 |

---

## VI — Tests de performance et accessibilité (CDC §9.1)

| # | Scénario | Mesure | Statut |
|---|---|---|---|
| P-01 | Page d'accueil charge en < 3 s sur connexion simulée 3G | LCP < 3 s | 📋 |
| P-02 | Recherche /v1/search répond en < 800 ms (P95) | Latence API | 📋 |
| P-03 | Page de résultats avec 20 trajets charge < 2 s | LCP | 📋 |
| P-04 | Page liste sièges (50 sièges) charge < 1 s | LCP | 📋 |
| P-05 | Pas de scroll horizontal sur mobile 375 px | UI | `04-navigation.spec.ts` | ✅ |

---

## Récapitulatif de couverture

| Zone | Total scénarios | Couverts auto. | Manuels | Nouveaux ajoutés |
|---|---|---|---|---|
| Livrables CDC §11 | 30 | 14 | 6 | 10 |
| Voyageur §5.1 | 11 | 5 | 3 | 3 |
| Coopérative §5.2 | 8 | 3 | 0 | 5 |
| Conducteur §5.3 | 6 | 0 | 0 | 6 |
| Admin §5.4 | 6 | 0 | 0 | 6 |
| Notifications §5.5 | 5 | 0 | 2 | 3 |
| Multilinguisme §5.6 | 6 | 4 | 0 | 2 |
| Règles VH-01..13 | 13 | 0 | 2 | 11 |
| Sécurité §9.2 | 9 | 1 | 0 | 8 |
| Temps réel WebSocket | 5 | 0 | 0 | 5 |
| **TOTAL** | **99** | **27** | **13** | **59** |

---

## Fichiers de tests automatisés

```
frontend/e2e/
├── 01-home-search.spec.ts        ✅ existant
├── 02-auth.spec.ts               ✅ existant (+ ajouts VH-12, S-09)
├── 03-language-switch.spec.ts    ✅ existant
├── 04-navigation.spec.ts         ✅ existant
├── 05-cooperatives.spec.ts       ✅ existant
├── 06-authenticated.spec.ts      ✅ existant
├── 07-booking.spec.ts            ✅ existant
├── 08-coop-backoffice.spec.ts    ✅ existant
├── 09-otp-auth.spec.ts           ✅ existant
├── 10-walkin.spec.ts             🆕 créé dans cette session
├── 11-driver-app.spec.ts         🆕 créé dans cette session
├── 12-admin-console.spec.ts      🆕 créé dans cette session
├── 13-ratings.spec.ts            🆕 créé dans cette session
├── 14-profile.spec.ts            🆕 créé dans cette session
├── 15-exports.spec.ts            🆕 créé dans cette session
├── 16-notifications.spec.ts      🆕 créé dans cette session
├── 17-business-rules.spec.ts     🆕 créé dans cette session
└── 18-realtime.spec.ts           🆕 créé dans cette session
```

---

*InsTRAM — Plan de tests — CODEL Technologies Co. — Confidentiel*
