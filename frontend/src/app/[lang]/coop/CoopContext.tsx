'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Cooperative, CooperativeRole } from '@/lib/types';

interface CoopContextValue {
  cooperative: Cooperative;
  role: CooperativeRole;
  userId: string;
  lang: string;
}

const CoopContext = createContext<CoopContextValue | null>(null);

interface CoopProviderProps {
  cooperative: Cooperative;
  role: CooperativeRole;
  userId: string;
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

export function useCoop(): CoopContextValue {
  const ctx = useContext(CoopContext);
  if (!ctx) {
    throw new Error('useCoop doit être utilisé dans un CoopProvider');
  }
  return ctx;
}
