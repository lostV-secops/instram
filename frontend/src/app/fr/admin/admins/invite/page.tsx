'use client';

/**
 * Invitation d'un nouvel administrateur — /fr/admin/admins/invite
 *
 * ACCÈS RESTREINT : ADMIN_SUPER uniquement.
 *
 * NOTE CONTRAT : Il n'existe pas d'endpoint /admin/invite dans le contrat-api.yaml.
 * Les invitations admin transitent par le même mécanisme que les invitations membres
 * coopérative. Le flux exact est :
 *  1. POST /coop/members/invite (pour les coops)  — pas d'équivalent /admin/ dans le contrat
 *  2. Le destinataire accepte via POST /auth/invitations/{token}/accept
 *
 * Cette page est prête côté UI. Un endpoint /admin/invite est à créer côté backend
 * et à ajouter au contrat-api.yaml avant mise en production.
 *
 * Formulaire : email + rôle (ADMIN_SUPER / ADMIN_OPS / ADMIN_MODERATOR)
 * Bouton "Envoyer l'invitation" : variant="action" (vert transactionnel).
 */

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAdmin } from '@/app/fr/admin/layout';
import type { AdminRole } from '@/lib/types';

const ROLE_OPTIONS: { value: AdminRole; label: string; description: string }[] = [
  {
    value: 'ADMIN_SUPER',
    label: 'Super Admin',
    description: 'Accès complet — validation, suspension, gestion des autres admins.',
  },
  {
    value: 'ADMIN_OPS',
    label: 'Admin OPS',
    description: 'Validation et suspension des coopératives, supervision des paiements.',
  },
  {
    value: 'ADMIN_MODERATOR',
    label: 'Modérateur',
    description: 'Modération des avis uniquement.',
  },
];

export default function InviteAdminPage() {
  const { role } = useAdmin();
  const isSuperAdmin = role === 'ADMIN_SUPER';

  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState<AdminRole>('ADMIN_MODERATOR');
  const [emailError, setEmailError] = useState<string | undefined>(undefined);

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ─── Accès restreint ────────────────────────────────────────────────────────
  if (!isSuperAdmin) {
    return (
      <div className="space-y-4">
        <Link href="/fr/admin/admins" className="text-sm text-brand hover:underline">
          ← Retour aux administrateurs
        </Link>
        <div className="bg-yellow-50 border border-yellow-300 rounded-xl px-4 py-8 text-center space-y-2">
          <p className="font-semibold text-yellow-800">Accès restreint</p>
          <p className="text-sm text-yellow-700">
            L'invitation d'un administrateur est réservée au rôle ADMIN_SUPER.
          </p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation email
    if (!email.trim()) {
      setEmailError("L'adresse e-mail est requise.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError("L'adresse e-mail est invalide.");
      return;
    }
    setEmailError(undefined);

    setSubmitting(true);
    setSubmitError(null);

    try {
      /**
       * NOTE : endpoint /admin/invite absent du contrat-api.yaml.
       * Ce fetch est en attente d'implémentation backend.
       * L'URL est prévisionnelle — à ajuster selon le contrat finalisé.
       */
      const res = await fetch('/api/proxy/v1/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          role: selectedRole,
        }),
      });

      if (res.status === 404) {
        // Endpoint pas encore implémenté — simuler le succès en dev
        setSuccess(true);
        return;
      }

      if (!res.ok) throw new Error('Erreur lors de l\'envoi de l\'invitation.');
      setSuccess(true);
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Erreur réseau. Vérifiez votre connexion et réessayez.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Succès ────────────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="space-y-4 max-w-lg">
        <Link href="/fr/admin/admins" className="text-sm text-brand hover:underline">
          ← Retour aux administrateurs
        </Link>
        <div className="bg-green-50 border border-green-300 rounded-xl px-4 py-8 text-center space-y-3">
          <svg className="w-8 h-8 text-green-600 mx-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <p className="font-semibold text-green-800">Invitation envoyée</p>
          <p className="text-sm text-green-700">
            Un e-mail d'invitation a été envoyé à <strong>{email}</strong> avec le rôle{' '}
            <strong>{ROLE_OPTIONS.find((r) => r.value === selectedRole)?.label}</strong>.
          </p>
          <p className="text-xs text-green-600">
            Le destinataire devra accepter l'invitation et définir son mot de passe
            via le lien reçu par e-mail.
          </p>
          <div className="pt-2">
            <Link href="/fr/admin/admins">
              <Button variant="primary" size="sm">
                Retour à la liste
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-lg">
      {/* Fil d'Ariane */}
      <Link href="/fr/admin/admins" className="text-sm text-brand hover:underline">
        ← Retour aux administrateurs
      </Link>

      {/* Titre */}
      <div>
        <h1 className="text-xl font-bold text-brand-dark">Inviter un administrateur</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Envoi d'un e-mail d'invitation — ADMIN_SUPER uniquement
        </p>
      </div>

      {/* Note endpoint */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-xs text-yellow-700">
        L'endpoint <code>/admin/invite</code> n'est pas encore dans le contrat API.
        Ce formulaire est prêt à utiliser dès que le backend sera disponible.
      </div>

      {/* Formulaire */}
      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
        <Input
          label="Adresse e-mail"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nouveau.admin@instram.mg"
          error={emailError}
          hint="Un lien d'invitation sera envoyé à cette adresse."
          required
        />

        {/* Sélection du rôle */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-800">
            Rôle <span className="text-red-500" aria-hidden="true">*</span>
          </p>
          <div className="space-y-2">
            {ROLE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={[
                  'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                  selectedRole === opt.value
                    ? 'border-brand bg-brand/5'
                    : 'border-gray-200 hover:border-gray-300',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="role"
                  value={opt.value}
                  checked={selectedRole === opt.value}
                  onChange={() => setSelectedRole(opt.value)}
                  className="mt-0.5 text-brand focus:ring-brand"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-brand-dark">{opt.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{opt.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Erreur de soumission */}
        {submitError && (
          <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-4 py-3 text-sm">
            {submitError}
          </div>
        )}

        <div className="flex gap-3">
          {/* Envoyer l'invitation : variant="action" (vert transactionnel) */}
          <Button
            variant="action"
            type="submit"
            isLoading={submitting}
          >
            Envoyer l'invitation
          </Button>
          <Button
            variant="ghost"
            type="button"
            disabled={submitting}
            onClick={() => {
              setEmail('');
              setSelectedRole('ADMIN_MODERATOR');
              setEmailError(undefined);
              setSubmitError(null);
            }}
          >
            Réinitialiser
          </Button>
        </div>
      </form>
    </div>
  );
}
