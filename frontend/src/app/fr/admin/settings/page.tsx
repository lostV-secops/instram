'use client';

/**
 * Paramètres plateforme — /fr/admin/settings
 *
 * Sections :
 *  1. Commission par défaut (%) — PUT /v1/admin/settings/commission
 *  2. Plage de silence SMS    — PUT /v1/admin/settings/sms-silence
 *
 * NOTE CONTRAT API : Les endpoints /admin/settings/commission et
 * /admin/settings/sms-silence sont ABSENTS du contrat-api.yaml actuel.
 * Ces endpoints sont à implémenter côté backend et à ajouter au contrat.
 * L'UI est prête et fonctionnelle dès que le backend sera disponible.
 *
 * Valeurs par défaut : commission 8 % (VH-04), silence 21h–06h (VH-02).
 *
 * Bouton "Enregistrer" : variant="action" (vert #9CC43D) — action de confirmation.
 * États de chargement et d'erreur explicites par section.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface SectionState {
  loading: boolean;
  success: string | null;
  error: string | null;
}

const initialSection: SectionState = { loading: false, success: null, error: null };

export default function AdminSettingsPage() {
  // Commission
  const [commission, setCommission] = useState('');
  const [commissionState, setCommissionState] = useState<SectionState>(initialSection);

  // Silence SMS
  const [smsStart, setSmsStart] = useState('');
  const [smsEnd, setSmsEnd] = useState('');
  const [smsState, setSmsState] = useState<SectionState>(initialSection);

  const handleSaveCommission = async (e: React.FormEvent) => {
    e.preventDefault();
    const rate = parseFloat(commission);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      setCommissionState((prev) => ({
        ...prev,
        error: 'Taux invalide. Entrez une valeur entre 0 et 100.',
      }));
      return;
    }

    setCommissionState({ loading: true, success: null, error: null });
    try {
      // NOTE : endpoint absent du contrat-api.yaml — à implémenter côté backend
      const res = await fetch('/api/proxy/v1/admin/settings/commission', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commissionRate: rate / 100 }),
      });
      if (!res.ok) throw new Error();
      setCommissionState({
        loading: false,
        success: 'Commission enregistrée avec succès.',
        error: null,
      });
    } catch {
      setCommissionState({
        loading: false,
        success: null,
        error: 'Erreur lors de l\'enregistrement. Vérifiez votre connexion.',
      });
    }
  };

  const handleSaveSms = async (e: React.FormEvent) => {
    e.preventDefault();
    const start = parseInt(smsStart, 10);
    const end = parseInt(smsEnd, 10);
    if (isNaN(start) || start < 0 || start > 23) {
      setSmsState((prev) => ({
        ...prev,
        error: 'Heure de début invalide (0-23).',
      }));
      return;
    }
    if (isNaN(end) || end < 0 || end > 23) {
      setSmsState((prev) => ({
        ...prev,
        error: 'Heure de fin invalide (0-23).',
      }));
      return;
    }

    setSmsState({ loading: true, success: null, error: null });
    try {
      // NOTE : endpoint absent du contrat-api.yaml — à implémenter côté backend
      const res = await fetch('/api/proxy/v1/admin/settings/sms-silence', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ silenceStart: start, silenceEnd: end }),
      });
      if (!res.ok) throw new Error();
      setSmsState({
        loading: false,
        success: 'Plage de silence SMS enregistrée.',
        error: null,
      });
    } catch {
      setSmsState({
        loading: false,
        success: null,
        error: 'Erreur lors de l\'enregistrement. Vérifiez votre connexion.',
      });
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      {/* Titre */}
      <div>
        <h1 className="text-xl font-bold text-brand-dark">Paramètres plateforme</h1>
        <p className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-2 py-1 mt-1 inline-block">
          Endpoints <code>/admin/settings/*</code> absents du contrat API — à implémenter côté backend.
        </p>
      </div>

      {/* Section 1 : Commission */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-brand-dark">Commission par défaut</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            S'applique aux nouvelles coopératives. Valeur par défaut : <strong>8 %</strong> (VH-04).
          </p>
        </div>

        <form onSubmit={handleSaveCommission} className="space-y-4">
          <Input
            label="Taux de commission (%)"
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
            placeholder="8"
            hint="Exemple : saisir 8 pour 8 %. S'applique sur le montant HT des réservations en ligne."
          />

          {commissionState.success && (
            <p role="status" className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
              {commissionState.success}
            </p>
          )}
          {commissionState.error && (
            <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {commissionState.error}
            </p>
          )}

          <Button
            variant="action"
            type="submit"
            isLoading={commissionState.loading}
          >
            Enregistrer
          </Button>
        </form>
      </section>

      {/* Section 2 : Plage de silence SMS */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-brand-dark">Plage de silence SMS</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Les notifications non-transactionnelles ne sont pas envoyées pendant cette plage.
            Valeur par défaut : <strong>21h — 06h</strong> (VH-02).
          </p>
        </div>

        <form onSubmit={handleSaveSms} className="space-y-4">
          <div className="flex gap-4">
            <Input
              label="Heure de début (silence)"
              type="number"
              min="0"
              max="23"
              value={smsStart}
              onChange={(e) => setSmsStart(e.target.value)}
              placeholder="21"
              hint="Heure locale (Madagascar, UTC+3). Ex : 21 pour 21h00."
            />
            <Input
              label="Heure de fin (silence)"
              type="number"
              min="0"
              max="23"
              value={smsEnd}
              onChange={(e) => setSmsEnd(e.target.value)}
              placeholder="6"
              hint="Ex : 6 pour 06h00."
            />
          </div>

          {smsState.success && (
            <p role="status" className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
              {smsState.success}
            </p>
          )}
          {smsState.error && (
            <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {smsState.error}
            </p>
          )}

          <Button
            variant="action"
            type="submit"
            isLoading={smsState.loading}
          >
            Enregistrer
          </Button>
        </form>
      </section>
    </div>
  );
}
