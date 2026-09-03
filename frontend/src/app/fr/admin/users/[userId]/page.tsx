'use client';

/**
 * Détail d'un utilisateur — /fr/admin/users/[userId]
 *
 * Endpoint (contrat-api.yaml) :
 *  - GET  /v1/admin/users?q={id}              → chercher l'utilisateur par id
 *  - POST /v1/admin/users/{id}/suspend         → suspendre le compte
 *
 * NOTE : Le contrat n'expose pas de GET /admin/users/{userId} direct.
 * On utilise la liste filtrée ou on affiche les infos disponibles.
 *
 * Affiche : profil, rôles, statut, réservations (non disponibles sans endpoint dédié),
 * bouton Suspendre si statut ACTIVE.
 *
 * États de chargement et d'erreur explicites.
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import type { AdminUserSummary, AdminUserStatus } from '@/lib/types';

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

export default function AdminUserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.userId as string;

  const [user, setUser] = useState<AdminUserSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal de suspension
  const [suspendReason, setSuspendReason] = useState('');
  const [suspendReasonError, setSuspendReasonError] = useState<string | undefined>(undefined);
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [suspendError, setSuspendError] = useState<string | null>(null);

  /**
   * NOTE CONTRAT : GET /admin/users retourne un tableau filtré par `q`.
   * Il n'existe pas de GET /admin/users/{id} direct dans le contrat.
   * On charge l'utilisateur en cherchant par userId dans la liste.
   */
  const loadUser = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/proxy/v1/admin/users?q=${encodeURIComponent(userId)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error();
      const data: AdminUserSummary[] = await res.json();
      const found = data.find((u) => u.id === userId) ?? data[0] ?? null;
      if (!found) throw new Error('Utilisateur introuvable.');
      setUser(found);
    } catch {
      setError('Impossible de charger cet utilisateur. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const handleSuspend = async () => {
    if (!suspendReason.trim()) {
      setSuspendReasonError('Le motif est obligatoire.');
      return;
    }
    setSuspendReasonError(undefined);
    setSuspending(true);
    setSuspendError(null);

    try {
      const res = await fetch(
        `/api/proxy/v1/admin/users/${userId}/suspend`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: suspendReason.trim() }),
        },
      );
      if (!res.ok) throw new Error();
      const updated: AdminUserSummary = await res.json();
      setUser(updated);
      setShowSuspendModal(false);
      setSuspendReason('');
    } catch {
      setSuspendError('Erreur lors de la suspension. Vérifiez votre connexion.');
    } finally {
      setSuspending(false);
    }
  };

  // ─── Chargement ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-32" />
        <div className="h-48 bg-gray-200 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/fr/admin/users" className="text-sm text-brand hover:underline">
          ← Retour à la liste
        </Link>
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 flex items-start gap-3">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <p className="font-medium">{error}</p>
            <button type="button" onClick={loadUser} className="text-sm underline mt-1">
              Réessayer
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const formattedDate = new Date(user.createdAt).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Fil d'Ariane */}
      <Link href="/fr/admin/users" className="text-sm text-brand hover:underline">
        ← Retour à la liste
      </Link>

      {/* Titre */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-brand-dark">
            {user.email ?? user.phone ?? 'Utilisateur'}
          </h1>
          <p className="text-xs text-gray-400 font-mono mt-0.5">{user.id}</p>
        </div>
        <Badge variant={statusVariants[user.status]}>
          {statusLabels[user.status]}
        </Badge>
      </div>

      {/* Fiche */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <dl className="divide-y divide-gray-100">
          {[
            { label: 'Email', value: user.email ?? '—' },
            { label: 'Téléphone', value: user.phone ?? '—' },
            { label: 'Statut', value: statusLabels[user.status] },
            { label: 'Inscrit le', value: formattedDate },
          ].map(({ label, value }) => (
            <div key={label} className="px-4 py-3 flex gap-4">
              <dt className="text-sm text-gray-500 w-36 flex-shrink-0">{label}</dt>
              <dd className="text-sm font-medium text-brand-dark">{value}</dd>
            </div>
          ))}
          <div className="px-4 py-3 flex gap-4">
            <dt className="text-sm text-gray-500 w-36 flex-shrink-0">Rôles</dt>
            <dd className="flex flex-wrap gap-1">
              {user.roles.length > 0
                ? user.roles.map((r) => (
                    <Badge key={r} variant="info" className="text-xs">
                      {r}
                    </Badge>
                  ))
                : <span className="text-sm text-gray-400">Aucun rôle</span>}
            </dd>
          </div>
        </dl>
      </div>

      {/* Actions */}
      {user.status === 'ACTIVE' && (
        <div className="flex gap-3">
          <Button
            variant="danger"
            onClick={() => setShowSuspendModal(true)}
          >
            Suspendre le compte
          </Button>
        </div>
      )}

      {/* Note sur les réservations */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-xs text-gray-500">
        Le détail des réservations de cet utilisateur n'est pas disponible via l'API admin
        (endpoint non documenté dans le contrat). Utilisez la page{' '}
        <Link href="/fr/admin/bookings" className="text-brand hover:underline">
          Supervision des paiements
        </Link>{' '}
        pour consulter les transactions associées.
      </div>

      {/* Modal de suspension */}
      {showSuspendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-base font-bold text-brand-dark">Suspendre le compte</h2>
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              Action irréversible — un AuditLog est créé.
            </p>
            <Input
              label="Motif de suspension"
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Ex. : Comportement frauduleux, signalement…"
              error={suspendReasonError}
              required
            />
            {suspendError && (
              <p role="alert" className="text-xs text-red-600">{suspendError}</p>
            )}
            <div className="flex gap-3 pt-2">
              <Button
                variant="danger"
                fullWidth
                isLoading={suspending}
                disabled={suspending}
                onClick={handleSuspend}
              >
                Confirmer
              </Button>
              <Button
                variant="ghost"
                fullWidth
                disabled={suspending}
                onClick={() => {
                  setShowSuspendModal(false);
                  setSuspendReason('');
                  setSuspendReasonError(undefined);
                  setSuspendError(null);
                }}
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
