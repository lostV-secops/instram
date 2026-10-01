'use client';

/**
 * Contexte coopérative — transmis depuis le layout Server Component vers les
 * Client Components enfants.
 *
 * Le layout (Server Component) récupère les données de la coopérative et
 * les passe à ce Provider via props.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { Cooperative, CooperativeRole } from '@/lib/types';

interface CoopContextValue {
  cooperative: Cooperative;
  /** Rôle de l'utilisateur connecté dans cette coopérative */
  role: CooperativeRole;
  /** ID utilisateur */
  userId: string;
  /** Langue active (fr ou mg) */
  lang: string;
}

const CoopContext = createContext<CoopContextValue | null>(null);

interface CoopProviderProps {
  cooperative: Cooperative;
  role: CooperativeRole;
  userId: string;
  /** Langue active, default 'fr' */
  lang?: string;
  children: ReactNode;
}

export function CoopProvider({
  cooperative,
  role,
  userId,
  lang = 'fr',
  children,
}: CoopProviderProps) {
  return (
    <CoopContext.Provider value={{ cooperative, role, userId, lang }}>
      {children}
    </CoopContext.Provider>
  );
}

/** Hook pour accéder au contexte coopérative dans un Client Component. */
export function useCoop(): CoopContextValue {
  const ctx = useContext(CoopContext);
  if (!ctx) {
    throw new Error('useCoop doit être utilisé dans un CoopProvider');
  }
  return ctx;
}
