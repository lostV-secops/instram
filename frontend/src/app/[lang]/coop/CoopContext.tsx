'use client';

/**
 * Contexte coopérative bilingue — transmis depuis le layout [lang]/coop/.
 *
 * Re-exporte le CoopProvider et useCoop depuis fr/coop/CoopContext afin que
 * la même instance de contexte React soit partagée entre les layouts fr/coop/
 * et [lang]/coop/, garantissant que CoopSidebar et CoopHeader fonctionnent
 * correctement quel que soit le segment de route actif.
 *
 * Le layout [lang]/coop/layout.tsx passe lang={params.lang} au CoopProvider,
 * ce qui rend la langue dynamique disponible via useCoop().lang.
 */

export { CoopProvider, useCoop } from '@/app/fr/coop/CoopContext';
export type { } from '@/app/fr/coop/CoopContext';
