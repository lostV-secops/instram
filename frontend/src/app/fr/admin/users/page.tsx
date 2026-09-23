'use client';

/**
 * Liste et gestion des utilisateurs — /fr/admin/users
 *
 * Appelle GET /v1/admin/users?q=...&role=... (contrat-api.yaml, tag Admin).
 * Affiche : nom/contact, rôles, statut, date de création.
 * Action : Suspendre un compte → POST /v1/admin/users/{id}/suspend { reason }
 * Lien vers /fr/admin/users/{id} pour le détail.
 *
 * États de chargement et d'erreur explicites.
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { AdminUserSummary, AdminUserStatus } from '@/lib/types';

const ROLE_OPTIONS = [
  { value: '', label: 'Tous les rôles' },
  { value: 'TRAVELER', label: 'Voyageur' },
  { value: 'COOP_ADMIN', label: 'Admin coopérative' },
  { value: 'COOP_ASSISTANT', label: 'Assistant coopérative' },
  { value: 'COOP_DRIVER', label: 'Conducteur' },
  { value: 'COOP_CONTROLLER', label: 'Contrôleur' },
  { value: 'ADMIN_SUPER', label: 'Super Admin' },
  { value: 'ADMIN_OPS', label: 'Admin OPS' },
  { value: 'ADMIN_MODERATOR', label: 'Modérateur' },
];

const statusVariants: Record<AdminUserStatus, 'success' | 'error' | 'neutral'> = {
  ACTIVE: 'success',
  SUSPENDED: 'error',
  DELETED: 'neutral',
};

const statusLabels: Record<AdminUserStatus, string> = {
  ACTIVE: 'Actif',
  SUSPENDED: 'Suspendu',
  DELETED: 'Supprimé',
};

interface SuspendModal {
  userId: string;
  reason: string;
  loading: boolean;
  error: string | null;
}

export default function AdminUsersPage() {
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suspendModal, setSuspendModal] = useState<SuspendModal | null>(null);

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (roleFilter) params.set('role', roleFilter);
    return `/api/proxy/v1/admin/users?${params.toString()}`;
  }, [query, roleFilter]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl(), { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const raw = await res.json();
      const items: AdminUserSummary[] = Array.isArray(raw) ? raw : (raw.items ?? []);
      setUsers(items);
    } catch {
      setError('Impossible de charger les utilisateurs. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  // Déclencher la recherche à la saisie (debounce minimal)
  useEffect(() => {
    const timer = setTimeout(() => {
      loadUsers();
    }, 300);
    return () => clearTimeout(timer);
  }, [loadUsers]);

  const handleSuspend = async () => {
    if (!suspendModal) return;
    if (!suspendModal.reason.trim()) {
      setSuspendModal((prev) =>
        prev ? { ...prev, error: 'Le motif est requis.' } : null,
      );
      return;
    }

    setSuspendModal((prev) => prev ? { ...prev, loading: true, error: null } : null);

    try {
      const res = await fetch(
        `/api/proxy/v1/admin/users/${suspendModal.userId}/suspend`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: suspendModal.reason }),
        },
      );
      if (!res.ok) throw new Error();
      const updated: AdminUserSummary = await res.json();
      setUsers((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u)),
      );
      setSuspendModal(null);
    } catch {
      setSuspendModal((prev) =>
        prev ? { ...prev, loading: false, error: 'Erreur. Vérifiez votre connexion.' } : null,
      );
    }
  };

  return (
    <div className="space-y-5">
      {/* Titre */}
      <h1 className="text-xl font-bold text-brand-dark">Utilisateurs</h1>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <Input
            label="Recherche"
            placeholder="Nom, email, téléphone..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="role-filter" className="text-xs text-gray-600">Rôle</label>
          <select
            id="role-filter"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand bg-white"
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Chargement */}
      {loading && (
        <div className="space-y-2 animate-pulse">
          {[...Array(5)].map((_, i) => (
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
            <button type="button" onClick={loadUsers} className="text-sm underline mt-1">Réessayer</button>
          </div>
        </div>
      )}

      {/* Tableau */}
      {!loading && !error && (
        <>
          {users.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-10 text-center text-sm text-gray-500">
              Aucun utilisateur trouvé.
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Rôles</th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Statut</th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Inscrit le</th>
                      <th className="py-2 px-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-4">
                          {user.email && (
                            <p className="text-sm text-gray-700 truncate max-w-[160px]">{user.email}</p>
                          )}
                          {user.phone && (
                            <p className="text-xs text-gray-500">{user.phone}</p>
                          )}
                          {!user.email && !user.phone && (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1">
                            {user.roles.slice(0, 2).map((role) => (
                              <Badge key={role} variant="info" className="text-xs">
                                {role}
                              </Badge>
                            ))}
                            {user.roles.length > 2 && (
                              <Badge variant="neutral">+{user.roles.length - 2}</Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant={statusVariants[user.status]}>
                            {statusLabels[user.status]}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-500">
                          {new Date(user.createdAt).toLocaleDateString('fr-FR', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-3">
                            <Link
                              href={`/fr/admin/users/${user.id}`}
                              className="text-xs text-brand hover:underline font-medium"
                            >
                              Voir
                            </Link>
                            {user.status === 'ACTIVE' && (
                              <button
                                type="button"
                                onClick={() =>
                                  setSuspendModal({
                                    userId: user.id,
                                    reason: '',
                                    loading: false,
                                    error: null,
                                  })
                                }
                                className="text-xs text-red-600 hover:underline font-medium"
                              >
                                Suspendre
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal de suspension */}
      {suspendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-bold text-brand-dark">Suspendre le compte</h2>
            <p className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
              Action irréversible — un AuditLog est créé.
            </p>
            <Input
              label="Motif de suspension"
              value={suspendModal.reason}
              onChange={(e) =>
                setSuspendModal((prev) =>
                  prev ? { ...prev, reason: e.target.value } : null,
                )
              }
              placeholder="Ex. : Comportement frauduleux, signalement..."
              error={suspendModal.error ?? undefined}
              required
            />
            <div className="flex gap-3 pt-2">
              <Button
                variant="danger"
                fullWidth
                isLoading={suspendModal.loading}
                disabled={suspendModal.loading}
                onClick={handleSuspend}
              >
                Confirmer
              </Button>
              <Button
                variant="ghost"
                fullWidth
                disabled={suspendModal.loading}
                onClick={() => setSuspendModal(null)}
              >
                Annuler
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
