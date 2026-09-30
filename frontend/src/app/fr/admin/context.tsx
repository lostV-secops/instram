'use client';

import { createContext, useContext } from 'react';
import type { AdminRole } from '@/lib/types';

export interface AdminContextValue {
  role: AdminRole;
  userId: string;
}

export const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin doit être utilisé dans AdminLayout');
  return ctx;
}
