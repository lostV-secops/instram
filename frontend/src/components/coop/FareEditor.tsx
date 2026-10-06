'use client';

/**
 * Éditeur de tarifs par catégorie de siège.
 *
 * Reçoit les tarifs actuels en props (chargés par le Server Component parent).
 * Soumet un PUT /coop/trips/{tripId}/fares avec les nouveaux prix.
 *
 * RÈGLE RG-04 : la coopérative fixe librement ses tarifs — aucune validation
 * côté InsTRAM n'est affichée ou imposée.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import type { Fare, SeatCategory } from '@/lib/types';

const CATEGORIES: SeatCategory[] = ['VIP', 'PREMIUM', 'CLASSIC', 'STANDARD'];

const CATEGORY_LABELS: Record<SeatCategory, string> = {
  VIP: 'VIP',
  PREMIUM: 'Premium',
  CLASSIC: 'Classique',
  STANDARD: 'Standard',
};

interface FareEditorProps {
  tripId: string;
  initialFares: Fare[];
}

export function FareEditor({ tripId, initialFares }: FareEditorProps) {
  const router = useRouter();

  // Initialiser l'état avec les tarifs existants
  const initialPrices = Object.fromEntries(
    CATEGORIES.map((cat) => {
      const existing = initialFares.find((f) => f.category === cat);
      return [cat, existing ? String(existing.priceMga) : ''];
    }),
  ) as Record<SeatCategory, string>;

  const [prices, setPrices] = useState<Record<SeatCategory, string>>(initialPrices);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleChange = (cat: SeatCategory, value: string) => {
    setPrices((prev) => ({ ...prev, [cat]: value }));
    setError(null);
    setSuccess(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    // Construire le tableau de tarifs (ne soumettre que les prix renseignés)
    const faresPayload = CATEGORIES.filter((cat) => prices[cat].trim() !== '').map((cat) => {
      const parsed = parseInt(prices[cat], 10);
      return { seatCategory: cat, priceMga: isNaN(parsed) ? 0 : parsed };
    });

    if (faresPayload.length === 0) {
      setError('Renseignez au moins un tarif.');
      return;
    }

    const invalidFare = faresPayload.find((f) => f.priceMga < 0);
    if (invalidFare) {
      setError('Les prix doivent être positifs.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`/api/proxy/v1/coop/trips/${tripId}/fares`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(faresPayload),
      });

      if (!res.ok) {
        let body: { message?: string } = {};
        try {
          body = await res.json();
        } catch { /* ignore */ }
        throw new Error(body.message ?? `Erreur ${res.status}`);
      }

      setSuccess(true);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        msg.includes('fetch')
          ? 'Erreur réseau. Vérifiez votre connexion et réessayez.'
          : `Erreur : ${msg}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {/* Bandeau souveraineté coopérative */}
      <div className="bg-brand/5 border border-brand/20 rounded-lg px-4 py-3 text-sm text-brand-dark">
        La coopérative fixe librement ses tarifs (RG-04). Aucune validation
        InsTRAM n'est appliquée.
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {CATEGORIES.map((cat) => (
          <Input
            key={cat}
            label={CATEGORY_LABELS[cat]}
            type="number"
            min="0"
            step="100"
            value={prices[cat]}
            onChange={(e) => handleChange(cat, e.target.value)}
            placeholder="Prix en Ar"
            hint="Ariary (MGA)"
            disabled={isLoading}
          />
        ))}
      </div>

      {error && (
        <div
          role="alert"
          className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-4 py-3 text-sm"
        >
          {error}
        </div>
      )}

      {success && (
        <div
          role="status"
          className="bg-green-50 border border-green-300 text-green-700 rounded-lg px-4 py-3 text-sm"
        >
          Tarifs enregistrés avec succès.
        </div>
      )}

      {/* Bouton vert UNIQUEMENT car action transactionnelle (enregistrer tarifs) */}
      <Button
        type="submit"
        variant="action"
        isLoading={isLoading}
        disabled={isLoading}
      >
        Enregistrer les tarifs
      </Button>
    </form>
  );
}

export default FareEditor;
