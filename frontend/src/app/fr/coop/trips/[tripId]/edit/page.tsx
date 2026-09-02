'use client';

/**
 * Modifier un trajet — /fr/coop/trips/{tripId}/edit
 * PATCH /coop/trips/{tripId}
 */

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import type { TripInstanceCoopDetail, CoopVehicle } from '@/lib/types';

export default function EditTripPage() {
  const params = useParams();
  const router = useRouter();
  const tripId = params.tripId as string;

  const [trip, setTrip] = useState<TripInstanceCoopDetail | null>(null);
  const [vehicles, setVehicles] = useState<CoopVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [vehicleId, setVehicleId] = useState('');
  const [departureAt, setDepartureAt] = useState('');
  const [arrivalEstimatedAt, setArrivalEstimatedAt] = useState('');
  const [notesFr, setNotesFr] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Convertir ISO en format datetime-local
  function toLocalInput(iso: string): string {
    try {
      const d = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return ''; }
  }

  useEffect(() => {
    const load = async () => {
      setLoadError(null);
      try {
        const [tripRes, vehiclesRes] = await Promise.all([
          fetch(`/api/proxy/v1/coop/trips/${tripId}`, { cache: 'no-store' }),
          fetch('/api/proxy/v1/coop/vehicles', { cache: 'no-store' }),
        ]);
        if (!tripRes.ok) throw new Error('Trajet introuvable.');
        const [tripData, vehiclesData] = await Promise.all([
          tripRes.json() as Promise<TripInstanceCoopDetail>,
          vehiclesRes.ok ? vehiclesRes.json() : [],
        ]);
        setTrip(tripData);
        setVehicles(
          (Array.isArray(vehiclesData) ? vehiclesData : []).filter(
            (v: CoopVehicle) => v.isActive,
          ),
        );
        setVehicleId(tripData.vehicle?.id ?? '');
        setDepartureAt(toLocalInput(tripData.departureAt));
        if (tripData.arrivalEstimatedAt) {
          setArrivalEstimatedAt(toLocalInput(tripData.arrivalEstimatedAt));
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Erreur réseau.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [tripId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!departureAt) { setSubmitError('La date de départ est requise.'); return; }

    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        vehicleId: vehicleId || undefined,
        departureAt: new Date(departureAt).toISOString(),
      };
      if (arrivalEstimatedAt) payload.arrivalEstimatedAt = new Date(arrivalEstimatedAt).toISOString();
      if (notesFr.trim()) payload.notesFr = notesFr.trim();

      const res = await fetch(`/api/proxy/v1/coop/trips/${tripId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? `Erreur ${res.status}`);
      }
      router.push(`/fr/coop/trips/${tripId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(
        msg.toLowerCase().includes('fetch')
          ? 'Erreur réseau. Vérifiez votre connexion et réessayez.'
          : `Erreur : ${msg}`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <div className="animate-pulse space-y-4 max-w-lg"><div className="h-8 bg-gray-200 rounded w-48" /><div className="h-48 bg-gray-200 rounded-xl" /></div>;
  }

  if (loadError || !trip) {
    return (
      <div className="space-y-4 max-w-lg">
        <Link href={`/fr/coop/trips/${tripId}`} className="text-brand text-sm hover:underline">← Retour</Link>
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 text-sm">{loadError}</div>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-4">
      <Link href={`/fr/coop/trips/${tripId}`} className="text-brand text-sm hover:underline">← Retour au trajet</Link>
      <h1 className="text-xl font-bold text-brand-dark">Modifier le trajet</h1>

      <form onSubmit={handleSubmit} className="space-y-4 bg-white border border-gray-200 rounded-xl p-5" noValidate>
        {/* Véhicule */}
        <div className="flex flex-col gap-1">
          <label htmlFor="vehicle-select" className="text-sm font-medium text-gray-800">Véhicule</label>
          <select
            id="vehicle-select"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
          >
            <option value="">Inchangé</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.displayName} — {v.registration}
              </option>
            ))}
          </select>
        </div>

        <Input
          label="Date et heure de départ"
          type="datetime-local"
          value={departureAt}
          onChange={(e) => setDepartureAt(e.target.value)}
          required
          disabled={isSubmitting}
        />

        <Input
          label="Arrivée estimée (optionnel)"
          type="datetime-local"
          value={arrivalEstimatedAt}
          onChange={(e) => setArrivalEstimatedAt(e.target.value)}
          disabled={isSubmitting}
        />

        <div className="flex flex-col gap-1">
          <label htmlFor="notes" className="text-sm font-medium text-gray-800">Notes (optionnel)</label>
          <textarea
            id="notes"
            value={notesFr}
            onChange={(e) => setNotesFr(e.target.value)}
            rows={2}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand resize-none"
            disabled={isSubmitting}
          />
        </div>

        {submitError && (
          <div role="alert" className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-4 py-3 text-sm">
            {submitError}
          </div>
        )}

        {/* Vert car action d'enregistrement (transactionnelle) */}
        <Button type="submit" variant="action" fullWidth isLoading={isSubmitting}>
          Enregistrer
        </Button>
      </form>
    </div>
  );
}
