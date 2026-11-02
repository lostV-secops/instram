'use client';

/**
 * Gestion des administrateurs InsTRAM — /fr/admin/admins
 *
 * ACCÈS RESTREINT : ADMIN_SUPER uniquement.
 * Les rôles ADMIN_OPS et ADMIN_MODERATOR voient un message "Accès restreint".
 *
 * Affiche la liste des utilisateurs avec rôles admin (ADMIN_SUPER, ADMIN_OPS, ADMIN_MODERATOR).
 * Source : GET /v1/admin/users?role=ADMIN_SUPER (puis ADMIN_OPS, ADMIN_MODERATOR).
 *
 * NOTE CONTRAT : Il n'existe pas d'endpoint GET /admin/admins dans le contrat.
 * On utilise GET /admin/users filtré par rôle.
 *
 * Lien vers /fr/admin/admins/invite pour inviter un nouvel admin.
 *
 * États de chargement et d'erreur explicites.
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useAdmin } from '@/app/fr/admin/context';
import type { AdminUserSummary, AdminRole, AdminUserStatus } from '@/lib/types';

const ADMIN_ROLE_OPTIONS: AdminRole[] = ['ADMIN_SUPER', 'ADMIN_OPS', 'ADMIN_MODERATOR'];

const roleLabels: Record<AdminRole, string> = {
  ADMIN_SUPER: 'Super Admin',
  ADMIN_OPS: 'Admin OPS',
  ADMIN_MODERATOR: 'Modérateur',
};

const roleBadgeVariants: Record<AdminRole, 'error' | 'warning' | 'info'> = {
  ADMIN_SUPER: 'error',
  ADMIN_OPS: 'warning',
  ADMIN_MODERATOR: 'info',
};

const statusLabels: Record<AdminUserStatus, string> = {
  ACTIVE: 'Actif',
  SUSPENDED: 'Suspendu',
  DELETED: 'Supprimé',
};

const statusVariants: Record<AdminUserStatus, 'success' | 'error' | 'neutral'> = {
  ACTIVE: 'success',
  SUSPENDED: 'error',
  DELETED: 'neutral',
};

interface AdminUser extends AdminUserSummary {
  adminRole?: AdminRole;
}

export default function AdminsPage() {
  const { role } = useAdmin();
  const isSuperAdmin = role === 'ADMIN_SUPER';

  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAdmins = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Charger les utilisateurs pour chaque rôle admin
      const results = await Promise.all(
        ADMIN_ROLE_OPTIONS.map(async (r) => {
          const res = await fetch(
            `/api/proxy/v1/admin/users?role=${r}`,
            { cache: 'no-store' },
          );
          if (!res.ok) return [] as AdminUser[];
          const result = await res.json();
          const data: AdminUserSummary[] = result.items ?? result;
          return (data ?? []).map((u) => ({ ...u, adminRole: r })) as AdminUser[];
        }),
      );

      // Dédupliquer par ID (un user peut avoir plusieurs rôles)
      const seen = new Set<string>();
      const merged: AdminUser[] = [];
      for (const list of results) {
        for (const user of list) {
          if (!seen.has(user.id)) {
            seen.add(user.id);
            merged.push(user);
          }
        }
      }
      setAdmins(merged);
    } catch {
      setError("Impossible de charger les administrateurs. Vérifiez votre connexion.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSuperAdmin) {
      loadAdmins();
    }
  }, [isSuperAdmin, loadAdmins]);

  // ─── Accès restreint ────────────────────────────────────────────────────────
  if (!isSuperAdmin) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-brand-dark">Administrateurs InsTRAM</h1>
        <div className="bg-yellow-50 border border-yellow-300 rounded-xl px-4 py-8 text-center space-y-2">
          <svg className="w-8 h-8 text-yellow-600 mx-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <p className="font-semibold text-yellow-800">Accès restreint</p>
          <p className="text-sm text-yellow-700">
            La gestion des administrateurs est réservée au rôle ADMIN_SUPER.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* En-tête */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-brand-dark">Administrateurs InsTRAM</h1>
          <p className="text-sm text-gray-500">
            Gestion des comptes admin — ADMIN_SUPER uniquement
          </p>
        </div>
        <Link href="/fr/admin/admins/invite">
          <Button variant="primary" size="sm">
            Inviter un admin
          </Button>
        </Link>
      </div>

      {/* Chargement */}
      {loading && (
        <div className="space-y-2 animate-pulse">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-200 rounded-lg" />
          ))}
        </div>
      )}

      {/* Erreur */}
      {!loading && error && (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 flex items-start gap-3">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <p className="font-medium">{error}</p>
            <button type="button" onClick={loadAdmins} className="text-sm underline mt-1">
              Réessayer
            </button>
          </div>
        </div>
      )}

      {/* Tableau */}
      {!loading && !error && (
        <>
          {admins.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-10 text-center text-sm text-gray-500">
              Aucun administrateur trouvé.
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Rôle admin</th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Statut</th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Inscrit le</th>
                    </tr>
                  </thead>
                  <tbody>
                    {admins.map((admin) => {
                      // Déterminer le rôle admin le plus élevé parmi les rôles de l'utilisateur
                      const highestRole = ADMIN_ROLE_OPTIONS.find((r) =>
                        admin.roles.includes(r),
                      ) as AdminRole | undefined;

                      return (
                        <tr key={admin.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-3 px-4">
                            {admin.email && (
                              <p className="text-sm text-gray-800 truncate max-w-[200px]">{admin.email}</p>
                            )}
                            {admin.phone && (
                              <p className="text-xs text-gray-500">{admin.phone}</p>
                            )}
                            {!admin.email && !admin.phone && (
                              <span className="text-xs text-gray-400 font-mono">{admin.id.slice(0, 8)}…</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {highestRole ? (
                              <Badge variant={roleBadgeVariants[highestRole]}>
                                {roleLabels[highestRole]}
                              </Badge>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <Badge variant={statusVariants[admin.status]}>
                              {statusLabels[admin.status]}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-xs text-gray-500">
                            {new Date(admin.createdAt).toLocaleDateString('fr-FR', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

    </div>
  );
}
