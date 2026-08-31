# Valeurs par défaut — InsTRAM

Ces valeurs sont les décisions de départ validées le 2026-08-31. Elles s'appliquent dès le développement initial et seront ajustées au fil du projet selon les retours terrain et opérationnels.

| ID | Sujet | Valeur par défaut | Ajustable |
|----|-------|-------------------|-----------|
| VH-01 | Durée du hold de siège | 2 min (sélection) + 5 min (paiement) = **7 min max** | Oui, par config env |
| VH-02 | Plage de silence SMS | **21h00 – 06h00** (UTC+3, heure malgache) | Oui, par config env |
| VH-03 | Clôture automatique d'un trajet | **72 h** après l'heure de départ prévue | Oui, par config env |
| VH-04 | Taux de commission InsTRAM | **8 %** par défaut, modifiable par coopérative | Oui, en back-office admin |
| VH-05 | Frais de service voyageur | **max(1 000 MGA, 3 % du billet)** | Oui, par config env |
| VH-06 | Fournisseur SMS | Abstraction générique, adaptateurs **Orange MG / Telma** | Oui, par adaptateur |
| VH-07 | Paiement mobile | **MVola + Orange Money** en V1 ; Airtel Money en V2 | Oui, par adaptateur |
| VH-08 | Rétention données personnelles | Anonymisation immédiate à la suppression de compte ; paiements conservés **10 ans** | Non (obligation légale) |
| VH-09 | Format QR code billet | JSON signé **HMAC** (ref réservation + ID trajet + siège + signature) | Non (protocole d'embarquement) |
| VH-10 | Devise | **MGA uniquement** en V1 | Prévu V2 |
| VH-11 | Catalogue géographique | **~119 districts malgaches** (seed initial) | Oui, via interface admin |
| VH-12 | Politique mots de passe | **Argon2id, 10 car. min** ; MFA optionnel pour admins InsTRAM | Oui, par config |
| VH-13 | Formats d'export | Manifeste : **CSV + PDF** ; Rapports financiers : **XLSX** | Oui, extensible |

## Règle d'ajustement

Toute modification d'une valeur de ce tableau doit être :
1. Tracée dans un commit avec le tag `[config]` dans le message.
2. Répercutée dans la variable d'environnement ou le paramètre de back-office correspondant.
3. Testée en staging avant mise en production.
