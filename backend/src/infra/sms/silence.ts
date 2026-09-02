/**
 * Logique de plage de silence nocturne — VH-02
 * Timezone Madagascar : UTC+3, sans passage à l'heure d'été.
 * Plage par défaut : 21h00 – 06h00 heure locale.
 *
 * Hypothèse documentée : le calcul de "lendemain 06h00" renvoie toujours
 * le prochain matin à endHour:00 heure malgache (j+1 depuis le début de la
 * journée locale courante), même si l'heure actuelle est 00h30 (dans ce
 * cas "demain 06h00" est bien 5h30 plus tard). Le mot "lendemain" dans le
 * CDC désigne le prochain matin de sortie de silence, pas forcément j+1
 * calendaire.
 */

/** Décalage horaire Madagascar — UTC+3 en millisecondes */
const MAD_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Retourne l'heure locale malgache (0-23) pour un instant UTC donné.
 */
function localHourMadagascar(now: Date): number {
  const localMs = now.getTime() + MAD_OFFSET_MS;
  return Math.floor((localMs / (60 * 60 * 1000)) % 24);
}

/**
 * Retourne true si l'envoi doit être différé (on est dans la plage de silence).
 *
 * La plage par défaut (startHour=21, endHour=6) couvre minuit :
 *   silence si heure >= 21 OU heure < 6
 *
 * Si startHour < endHour (ex. 9h-12h), la plage ne couvre pas minuit :
 *   silence si heure >= startHour ET heure < endHour
 */
export function isInSilenceWindow(
  now: Date,
  startHour: number,
  endHour: number,
): boolean {
  const h = localHourMadagascar(now);
  if (startHour > endHour) {
    // La plage traverse minuit (ex. 21h–06h)
    return h >= startHour || h < endHour;
  }
  // La plage est intra-journalière (cas non standard)
  return h >= startHour && h < endHour;
}

/**
 * Retourne la prochaine date d'envoi autorisée :
 * demain à endHour:00 heure malgache (UTC+3).
 *
 * "Demain" = j+1 du début de la journée locale courante.
 */
export function nextSendableTime(now: Date, endHour: number): Date {
  const localMs = now.getTime() + MAD_OFFSET_MS;
  // Début de la journée locale courante (minuit malgache)
  const localDayStartMs =
    Math.floor(localMs / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
  // Demain à endHour:00 en temps local
  const nextLocal =
    localDayStartMs + 24 * 60 * 60 * 1000 + endHour * 60 * 60 * 1000;
  // Conversion en UTC
  return new Date(nextLocal - MAD_OFFSET_MS);
}

/**
 * Détermine si un type de notification est transactionnel (bypass silence).
 *
 * Transactionnel (envoi immédiat même la nuit) :
 *   BOOKING_CONFIRMED, PAYMENT_CONFIRMED, WALK_IN_CONFIRMED
 *
 * Non transactionnel (différé si silence) :
 *   TRIP_REMINDER, RATING_REQUEST, PROMO, COOP_INVITE, BOOKING_CANCELLED
 *
 * Hypothèse : BOOKING_CANCELLED est classé non-transactionnel car il
 * s'agit d'une annulation physique au guichet (processus manuel, pas une
 * transaction financière en cours). Si l'architecture change, modifier ici.
 */
export function isTransactional(templateKey: string): boolean {
  const TRANSACTIONAL_KEYS = new Set([
    'BOOKING_CONFIRMED',
    'PAYMENT_CONFIRMED',
    'WALK_IN_CONFIRMED',
  ]);
  return TRANSACTIONAL_KEYS.has(templateKey);
}
