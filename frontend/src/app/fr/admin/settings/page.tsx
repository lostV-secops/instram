'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface PlatformFeeSettings {
  id: string;
  name: string;
  ratePercent: number | null;
  fixedAmountMga: number | null;
  minAmountMga: number | null;
  effectiveFrom: string;
}

interface PlatformSettings {
  platformFee: PlatformFeeSettings | null;
  smsQuietHoursStart: string;
  smsQuietHoursEnd: string;
}

interface SectionState {
  loading: boolean;
  success: string | null;
  error: string | null;
}

const initialSection: SectionState = { loading: false, success: null, error: null };

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadLoading, setLoadLoading] = useState(true);

  // Commission
  const [feeName, setFeeName] = useState('');
  const [feeRate, setFeeRate] = useState('');
  const [feeFixed, setFeeFixed] = useState('');
  const [feeMin, setFeeMin] = useState('');
  const [feeState, setFeeState] = useState<SectionState>(initialSection);

  // Silence SMS
  const [smsStart, setSmsStart] = useState('');
  const [smsEnd, setSmsEnd] = useState('');
  const [smsState, setSmsState] = useState<SectionState>(initialSection);

  const loadSettings = useCallback(async () => {
    setLoadLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/proxy/v1/admin/settings', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data: PlatformSettings = await res.json();
      setSettings(data);
      if (data.platformFee) {
        setFeeName(data.platformFee.name ?? '');
        setFeeRate(data.platformFee.ratePercent != null ? String(data.platformFee.ratePercent) : '');
        setFeeFixed(data.platformFee.fixedAmountMga != null ? String(data.platformFee.fixedAmountMga) : '');
        setFeeMin(data.platformFee.minAmountMga != null ? String(data.platformFee.minAmountMga) : '');
      }
      setSmsStart(data.smsQuietHoursStart ?? '');
      setSmsEnd(data.smsQuietHoursEnd ?? '');
    } catch {
      setLoadError('Impossible de charger les paramètres. Vérifiez votre connexion.');
    } finally {
      setLoadLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSaveFee = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeeState({ loading: true, success: null, error: null });
    try {
      const body: Record<string, unknown> = {
        platformFee: {
          name: feeName.trim() || 'Frais plateforme',
          ...(feeRate !== '' ? { ratePercent: parseFloat(feeRate) } : {}),
          ...(feeFixed !== '' ? { fixedAmountMga: parseInt(feeFixed, 10) } : {}),
          ...(feeMin !== '' ? { minAmountMga: parseInt(feeMin, 10) } : {}),
        },
      };
      const res = await fetch('/api/proxy/v1/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      await loadSettings();
      setFeeState({ loading: false, success: 'Politique de frais enregistrée.', error: null });
    } catch {
      setFeeState({ loading: false, success: null, error: 'Erreur lors de l\'enregistrement.' });
    }
  };

  const handleSaveSms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{2}:\d{2}$/.test(smsStart)) {
      setSmsState({ loading: false, success: null, error: 'Format invalide pour l\'heure de début (attendu : HH:MM).' });
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(smsEnd)) {
      setSmsState({ loading: false, success: null, error: 'Format invalide pour l\'heure de fin (attendu : HH:MM).' });
      return;
    }
    setSmsState({ loading: true, success: null, error: null });
    try {
      const res = await fetch('/api/proxy/v1/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smsQuietHoursStart: smsStart, smsQuietHoursEnd: smsEnd }),
      });
      if (!res.ok) throw new Error();
      setSmsState({ loading: false, success: 'Plage de silence SMS enregistrée.', error: null });
    } catch {
      setSmsState({ loading: false, success: null, error: 'Erreur lors de l\'enregistrement.' });
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-xl font-bold text-brand-dark">Paramètres plateforme</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Politique de frais InsTRAM et notifications SMS
        </p>
      </div>

      {loadLoading && (
        <div className="space-y-3 animate-pulse">
          <div className="h-40 bg-gray-200 rounded-xl" />
          <div className="h-40 bg-gray-200 rounded-xl" />
        </div>
      )}

      {!loadLoading && loadError && (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 flex items-start gap-3">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <p className="font-medium">{loadError}</p>
            <button type="button" onClick={loadSettings} className="text-sm underline mt-1">Réessayer</button>
          </div>
        </div>
      )}

      {!loadLoading && !loadError && (
        <>
          {/* Section 1 : Frais plateforme */}
          <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-brand-dark">Politique de frais plateforme</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                S'applique aux nouvelles réservations en ligne. Valeur par défaut : <strong>8 %</strong>.
                {settings?.platformFee && (
                  <span className="ml-1 text-green-700">
                    (active depuis le {new Date(settings.platformFee.effectiveFrom).toLocaleDateString('fr-FR')})
                  </span>
                )}
              </p>
            </div>

            <form onSubmit={handleSaveFee} className="space-y-4">
              <Input
                label="Nom de la politique"
                type="text"
                value={feeName}
                onChange={(e) => setFeeName(e.target.value)}
                placeholder="Frais plateforme"
                hint="Identifiant lisible dans les rapports."
              />
              <Input
                label="Taux (%)"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={feeRate}
                onChange={(e) => setFeeRate(e.target.value)}
                placeholder="8"
                hint="Exemple : 8 pour 8 %. Laisser vide pour ne pas appliquer de taux."
              />
              <div className="flex gap-4">
                <Input
                  label="Montant fixe (Ar)"
                  type="number"
                  min="0"
                  step="1"
                  value={feeFixed}
                  onChange={(e) => setFeeFixed(e.target.value)}
                  placeholder="0"
                  hint="En Ariary. 0 ou vide = aucun montant fixe."
                />
                <Input
                  label="Minimum (Ar)"
                  type="number"
                  min="0"
                  step="1"
                  value={feeMin}
                  onChange={(e) => setFeeMin(e.target.value)}
                  placeholder="0"
                  hint="Seuil minimum des frais prélevés."
                />
              </div>

              {feeState.success && (
                <p role="status" className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
                  {feeState.success}
                </p>
              )}
              {feeState.error && (
                <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                  {feeState.error}
                </p>
              )}

              <Button variant="primary" type="submit" isLoading={feeState.loading}>
                Enregistrer la politique
              </Button>
            </form>
          </section>

          {/* Section 2 : Plage de silence SMS */}
          <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-brand-dark">Plage de silence SMS</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Les notifications non-transactionnelles ne sont pas envoyées pendant cette plage.
                Valeur par défaut : <strong>22h00 — 06h00</strong>.
              </p>
            </div>

            <form onSubmit={handleSaveSms} className="space-y-4">
              <div className="flex gap-4">
                <Input
                  label="Début du silence (HH:MM)"
                  type="text"
                  pattern="\d{2}:\d{2}"
                  value={smsStart}
                  onChange={(e) => setSmsStart(e.target.value)}
                  placeholder="22:00"
                  hint="Heure locale Madagascar (UTC+3). Ex : 22:00"
                />
                <Input
                  label="Fin du silence (HH:MM)"
                  type="text"
                  pattern="\d{2}:\d{2}"
                  value={smsEnd}
                  onChange={(e) => setSmsEnd(e.target.value)}
                  placeholder="06:00"
                  hint="Ex : 06:00 pour 6h du matin."
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

              <Button variant="primary" type="submit" isLoading={smsState.loading}>
                Enregistrer
              </Button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
