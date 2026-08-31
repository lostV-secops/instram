# InsTRAM — Cahier des Charges

| Champ | Valeur |
|---|---|
| Projet | InsTRAM |
| Organisation | CODEL Technologies Co. |
| Porteur de projet | Jacques Chilas |
| Date | Avril 2026 |
| Confidentialité | Usage interne — Ne pas distribuer |

## 1. Présentation du Projet

### 1.1 Contexte

Le transport terrestre à Madagascar repose sur un réseau de coopératives et d'opérateurs privés qui fonctionnent hors-ligne, de manière fragmentée et sans traçabilité numérique. Les voyageurs n'ont aucune visibilité sur les horaires, la disponibilité ou la fiabilité des opérateurs avant de se présenter physiquement à la gare. Les coopératives gèrent leurs opérations avec des registres papier et une comptabilité cash difficile à tracer.

### 1.2 Le Projet

InsTRAM est une plateforme nationale de réservation de transport terrestre pour Madagascar. Elle permet à un voyageur de rechercher un trajet, choisir son siège et payer par Mobile Money depuis n'importe quel téléphone, tandis que chaque coopérative garde le contrôle total de ses lignes, ses prix et ses règles internes.

### 1.3 Principe Fondateur

Numériser les flux, pas remplacer les procédures. InsTRAM rend les trajets visibles, réservables et traçables — sans imposer aux coopératives des contraintes qu'elles n'ont pas choisies. Une coopérative continue de fonctionner comme elle l'entend ; InsTRAM ajoute une couche digitale par-dessus ses opérations existantes, elle ne les remplace pas.

## 2. Objectifs du Projet

- Donner aux voyageurs une visibilité en temps réel sur les trajets disponibles, tous opérateurs confondus.
- Permettre la réservation et le paiement Mobile Money depuis un téléphone, sans passer par un guichet.
- Digitaliser le suivi opérationnel des coopératives (réservations, embarquement, revenus) sans les obliger à changer leurs pratiques métier.
- Fournir aux coopératives un canal de vente supplémentaire à moindre friction, y compris pour les ventes physiques au guichet (walk-in).
- Poser les fondations d'une donnée nationale de mobilité terrestre, exploitable à terme par les coopératives elles-mêmes et par InsTRAM.

## 3. Utilisateurs et Bénéficiaires

| Profil | Qui | Besoin principal |
|---|---|---|
| Voyageur | Grand public, majoritairement sur mobile d'entrée de gamme et réseau 3G, paiement Mobile Money uniquement | Trouver un trajet, réserver un siège, payer, recevoir un billet — rapidement et simplement |
| Coopérative | Gestionnaires de flotte (5 à 50 véhicules), peu technophiles | Gérer routes, véhicules, horaires et prix ; suivre les réservations et les revenus |
| Conducteur / Contrôleur | Personnel de terrain, connexion instable | Vérifier rapidement les billets à l'embarquement |
| Administration InsTRAM | Équipe interne InsTRAM | Valider les coopératives, superviser la plateforme, gérer la facturation |

Le voyageur est la priorité absolue de conception : toute décision d'ergonomie, de performance ou de simplicité d'usage doit d'abord servir un utilisateur avec un téléphone modeste et une connexion lente.

## 4. Périmètre du Projet

### 4.1 Fonctionnalités incluses

- Recherche de trajets par ville de départ / arrivée et date, sur un catalogue national de villes (échelle district).
- Sélection visuelle des sièges, mise à jour en temps réel (un siège pris par un autre voyageur disparaît immédiatement de l'écran de tous).
- Paiement par Mobile Money (MVola, Orange Money).
- Billet numérique (QR code + référence courte), envoyé par SMS et consultable dans l'application.
- Réservation "walk-in" : le personnel de la coopérative peut créer une réservation directement au guichet, en cash ou en Mobile Money.
- Back-office coopérative complet : routes, véhicules, sièges, horaires, tarifs, personnel, politique d'annulation.
- Application conducteur : scan du billet à l'embarquement, liste des passagers, gestion des absences.
- Console d'administration InsTRAM : validation des coopératives, plans tarifaires, supervision, modération des avis.
- Notation des coopératives après voyage.
- Annuaire public des coopératives.
- Notifications par SMS (et relais push/e-mail).
- Interface bilingue français / malgache.
- Export de manifeste passagers et de rapports financiers.

### 4.2 Hors périmètre (phases ultérieures)

- Application mobile native (une version web mobile-first couvre le besoin en V1).
- Airtel Money (ajouté après stabilisation de MVola et Orange Money).
- Suivi GPS en temps réel des véhicules.
- Abonnements ou pass multi-trajets pour les voyageurs.
- Programme de fidélité.
- Ouverture de l'API à des agences de voyage tierces.
- Facturation automatique des abonnements coopérative (suivi manuel en V1).

## 5. Parcours et Fonctionnalités Clés

### 5.1 Voyageur

Le voyageur recherche un trajet par ville de départ, ville d'arrivée et date. Il compare les résultats (prix, horaire, note de la coopérative), consulte la politique de la coopérative choisie, sélectionne son siège sur une carte visuelle et paie par Mobile Money. Il reçoit son billet immédiatement, avant même que la fenêtre de silence nocturne des notifications ne s'applique. Il ne peut pas annuler sa réservation depuis l'application : toute annulation se fait physiquement, au guichet de la coopérative, selon la politique propre à celle-ci. Après le voyage, il peut noter la coopérative.

### 5.2 Coopérative

La coopérative configure librement ses routes, véhicules, sièges (avec catégories VIP / Premium / Classic / Standard), horaires et prix. Elle décide elle-même quand un trajet est ouvert à la réservation. Elle peut créer des réservations directement au guichet pour les clients qui se présentent physiquement (walk-in), sans frais supplémentaire. Elle dispose d'un tableau de bord pour suivre ses réservations, ses revenus nets et ses statistiques de remplissage. Elle gère son équipe (administrateurs, assistants, conducteurs, contrôleurs) par invitation.

### 5.3 Conducteur / Contrôleur

Le conducteur consulte la liste des passagers de son trajet et valide l'embarquement en scannant le billet (ou en saisissant la référence si le scan échoue). Il peut marquer un passager absent après le départ du véhicule, et signale le départ effectif dans l'application.

### 5.4 Administration InsTRAM

L'équipe InsTRAM valide l'inscription des coopératives, configure leur plan tarifaire, supervise l'activité globale, gère les paiements d'abonnement, modère les avis et intervient en cas d'anomalie (paiement en retard, fraude, litige).

### 5.5 Notifications

Les confirmations de paiement et les annulations de billet sont envoyées immédiatement par SMS, à toute heure. Les autres notifications (rappels de départ, alertes diverses) respectent une plage de silence nocturne. Le contenu est envoyé dans la langue préférée du destinataire.

### 5.6 Multilinguisme

L'ensemble de l'interface voyageur et coopérative est disponible en français et en malgache. La console d'administration InsTRAM reste en français.

## 6. Modèle Économique

InsTRAM génère des revenus de deux façons, indépendantes l'une de l'autre :

- **Côté coopérative** : chaque coopérative choisit entre un plan à la commission (pourcentage prélevé sur chaque réservation en ligne confirmée) ou un abonnement mensuel fixe selon la taille de sa flotte.
- **Côté voyageur** : des frais de service s'appliquent uniquement sur les réservations effectuées en ligne.

Les réservations effectuées au guichet (walk-in) sont exemptes de frais, aussi bien pour le voyageur que pour la coopérative. Ce choix est volontaire : sur le walk-in, la valeur d'InsTRAM est la donnée consolidée et l'adoption de la plateforme par la coopérative, pas la commission immédiate.

## 7. Règles de Gestion Essentielles

Ces règles encadrent le comportement du produit et ne doivent pas être remises en cause sans validation du porteur de projet :

- Aucune annulation ni remboursement ne se fait dans l'application : c'est un processus physique, propre à chaque coopérative.
- La coopérative reste souveraine sur ses prix, ses horaires et ses règles internes ; InsTRAM ne les impose ni ne les arbitre.
- Un siège réservé par un voyageur doit disparaître de la disponibilité pour tous les autres, en temps réel — pas de double réservation possible.
- Le walk-in est volontairement gratuit pour favoriser l'adoption par les coopératives non technophiles.
- Le personnel de la coopérative gère le contrôle d'accès et les manifestes de voyage à la gare, pas en ligne — cela préserve un parcours de réservation simple pour le voyageur.
- Un trajet est considéré terminé automatiquement après un délai raisonnable suivant le départ (les trajets malgaches longue distance peuvent durer plusieurs jours), sans action manuelle requise.
- La plateforme fonctionne exclusivement en temps réel : pas de mode hors-ligne, mais une attention particulière à la performance sur connexion lente.
- Un compte utilisateur supprimé voit ses données personnelles anonymisées immédiatement ; les données financières et d'audit sont conservées pour des raisons de conformité.

## 8. Identité Visuelle

Une charte graphique et une palette de couleurs sont imposées pour garantir une identité cohérente sur toutes les interfaces (voyageur, coopérative, conducteur, administration) :

| Rôle | Couleur | Usage |
|---|---|---|
| Couleur principale | #205E98 (bleu) | Navigation, boutons principaux |
| Couleur secondaire | #4596D7 (bleu clair) | Actions secondaires |
| Couleur institutionnelle | #162E49 (bleu foncé) | Zones officielles, footer |
| Couleur d'action | #9CC43D (vert) | Exclusivement les actions de réservation et de paiement |
| Couleurs de fond et de texte | Nuances de gris | Fonds, textes, bordures |
| Couleurs d'état | Jaune (alerte) / Rouge (erreur, annulation) | Statuts et actions destructives |

Le vert d'action est réservé aux actes transactionnels (réserver, payer, confirmer) — jamais utilisé en navigation ou en décoration.

## 9. Exigences Générales

### 9.1 Performance et Accessibilité

Le public visé utilise majoritairement des téléphones Android d'entrée de gamme sur des connexions 3G lentes et instables. Le produit doit rester utilisable dans ces conditions : chargement rapide, interface allégée, résilience aux coupures réseau. L'interface doit rester simple d'usage pour un public à littératie numérique variable.

### 9.2 Sécurité et Confidentialité

Les paiements et les données personnelles doivent être protégés selon les standards du secteur : communications chiffrées, vérification stricte des transactions Mobile Money, traçabilité complète des actions sensibles (paiements, annulations, accès administrateur). Les données personnelles des voyageurs sont conservées de façon proportionnée à leur usage et anonymisées lorsqu'elles ne sont plus nécessaires.

### 9.3 Disponibilité

La plateforme doit rester disponible en continu, avec une attention particulière portée aux services critiques (réservation, paiement), dont l'indisponibilité affecte directement l'activité des coopératives et la confiance des voyageurs.

## 10. Contraintes et Choix Techniques Généraux

Les technologies suivantes sont retenues pour la réalisation du projet et ne sont pas ouvertes à discussion :

- **Backend** : Node.js
- **Base de données** : PostgreSQL
- **Frontend** : Next.js (application web progressive, compatible mobile)
- **Temps réel** : WebSocket (obligatoire pour la disponibilité des sièges — pas de rafraîchissement périodique)

Le choix des bibliothèques, outils annexes, méthode de déploiement et conventions de code est laissé à l'équipe de développement, tant que les contraintes fonctionnelles et de performance ci-dessus sont respectées.

## 11. Livrables Attendus

- Application web voyageur (recherche, réservation, paiement, compte).
- Back-office coopérative (gestion opérationnelle complète).
- Application conducteur (scan billet, manifeste, embarquement).
- Console d'administration InsTRAM.
- Documentation technique de mise en production (déploiement, procédures de secours).
- Spécification d'interface (contrat API) entre les différents modules.

## 12. Glossaire

| Terme | Définition |
|---|---|
| Coopérative | Opérateur de transport (bus/minibus) partenaire de la plateforme |
| Walk-in | Réservation effectuée physiquement au guichet par le personnel de la coopérative |
| Manifeste | Liste des passagers d'un trajet, avec leurs informations complémentaires |
| Trajet (TripInstance) | Un départ précis, à une date et une heure données, sur une route donnée |
| MVola / Orange Money | Opérateurs de paiement mobile utilisés à Madagascar |

*InsTRAM — Cahier des Charges — CODEL Technologies Co. — Confidentiel*
