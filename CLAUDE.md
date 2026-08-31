# InsTRAM — Contexte projet

Plateforme de réservation de transport terrestre pour Madagascar (voyageur, coopérative, conducteur, admin InsTRAM).

## Stack imposée, non négociable
- Backend : Node.js
- Base de données : PostgreSQL
- Frontend : Next.js
- Temps réel : WebSocket (jamais de polling)

## Règles de gestion non négociables
- Zéro double réservation : un siège réservé disparaît en temps réel pour tous.
- Aucune annulation/remboursement dans l'application — c'est un processus physique côté coopérative.
- Le walk-in (réservation au guichet) est gratuit, sans exception.
- La coopérative reste souveraine sur ses prix, horaires et règles internes.
- Public cible : téléphones d'entrée de gamme, connexion 3G lente et instable.

## Charte graphique
- Bleu principal #205E98, bleu clair #4596D7, bleu foncé #162E49.
- Vert #9CC43D réservé EXCLUSIVEMENT aux actions transactionnelles (réserver, payer, confirmer).

## Contrat de référence
Tout agent doit respecter `docs/contrat-api.yaml` et `schema.prisma` une fois validés par l'Architecte — ne jamais improviser un endpoint ou un champ hors contrat sans le signaler.
