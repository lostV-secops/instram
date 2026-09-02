'use client';

/**
 * Créer un trajet — /fr/coop/trips/new
 *
 * Formulaire : sélection route, sélection véhicule, date/heure départ, notes.
 * POST /coop/trips
 *
 * Validation Zod-like côté client (sans dépendance externe pour légèreté).
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import type { CoopRouteDetail, CoopVehicle } from '@/lib/types';

interface FormErrors {
  routeId?: string;
  vehicleId?: string;
  departureAt?: string;
}

export default function NewTripPage() {
  const router = useRouter();

  const [routes, setRoutes] = useState<CoopRouteDetail[]>([]);
  const [vehicles, setVehicles] = useState<CoopVehicle[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  const [routeId, setRouteId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [departureAt, setDepartureAt] = useState('');
  const [arrivalEstimatedAt, setArrivalEstimatedAt] = useState('');
  const [notesFr, setNotesFr] = useState('');

  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Charger routes et véhicules en parallèle
  useEffect(() => {
    const load = async () => {
      setDataLoading(true);
      try {
        const [routesRes, vehiclesRes] = await Promise.all([
          fetch('/api/proxy/v1/coop/routes', { cache: 'no-store' }),
          fetch('/api/proxy/v1/coop/vehicles', { cache: 'no-store' }),
        ]);
        if (!routesRes.ok || !vehiclesRes.ok) throw new Error('Erreur de chargement');
        const [routesData, vehiclesData] = await Promise.all([
          routesRes.json(),
          vehiclesRes.json(),
        ]);
        setRoutes(Array.isArray(routesData) ? routesData : []);
        setVehicles(
          (Array.isArray(vehiclesData) ? vehiclesData : []).filter(
            (v: CoopVehicle) => v.isActive,
          ),
        );
      } catch {
        setLoadError('Erreur lors du chargement des données. Vérifiez votre connexion.');
      } finally {
        setDataLoading(false);
      }
    };
    load();
  }, []);

  const validate = (): boolean => {
    const newErrors: FormErrors = {};
    if (!routeId) newErrors.routeId = 'Sélectionnez une ligne.';
    if (!vehicleId) newErrors.vehicleId = 'Sélectionnez un véhicule.';
    if (!departureAt) newErrors.departureAt = 'La date et heure de départ est requise.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        routeId,
        vehicleId,
        departureAt: new Date(departureAt).toISOString(),
      };
      if (arrivalEstimatedAt) {
        payload.arrivalEstimatedAt = new Date(arrivalEstimatedAt).toISOString();
      }
      if (notesFr.trim()) payload.notesFr = notesFr.trim();

      const res = await fetch('/api/proxy/v1/coop/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let body: { message?: string } = {};
        try { body = await res.json(); } catch { /* ignore */ }
        throw new Error(body.message ?? `Erreur ${res.status}`);
      }

      const trip = await res.json();
      router.push(`/fr/coop/trips/${trip.id}`);
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

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/fr/coop/trips"
          className="text-brand text-sm hover:underline"
        >
          ← Retour aux trajets
        </Link>
      </div>

      <h1 className="text-xl font-bold text-brand-dark">Nouveau trajet</h1>

      {dataLoading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-12 bg-gray-200 rounded-lg" />
          <div className="h-12 bg-gray-200 rounded-lg" />
        </div>
      ) : loadError ? (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 text-sm">
          {loadError}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 bg-white border border-gray-200 rounded-xl p-5" noValidate>
          {/* Route */}
          <div className="flex flex-col gap-1">
            <label htmlFor="route-select" className="text-sm font-medium text-gray-800">
              Ligne <span className="text-red-500">*</span>
            </label>
            {routes.length === 0 ? (
              <p className="text-sm text-orange-600">
                Aucune ligne disponible.{' '}
                <Link href="/fr/coop/routes/new" className="underline">Créer une ligne</Link>
              </p>
            ) : (
              <select
                id="route-select"
                value={routeId}
                onChange={(e) => { setRouteId(e.target.value); setErrors((p) => ({ ...p, routeId: undefined })); }}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
                aria-invalid={!!errors.routeId}
              >
                <option value="">Sélectionner une ligne...</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>{r.displayName}</option>
                ))}
              </select>
            )}
            {errors.routeId && <p role="alert" className="text-xs text-red-600">{errors.routeId}</p>}
          </div>

          {/* Véhicule */}
          <div className="flex flex-col gap-1">
            <label htmlFor="vehicle-select" className="text-sm font-medium text-gray-800">
              Véhicule <span className="text-red-500">*</span>
            </label>
            {vehicles.length === 0 ? (
              <p className="text-sm text-orange-600">Aucun véhicule actif disponible.</p>
            ) : (
              <select
                id="vehicle-select"
                value={vehicleId}
                onChange={(e) => { setVehicleId(e.target.value); setErrors((p) => ({ ...p, vehicleId: undefined })); }}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
                aria-invalid={!!errors.vehicleId}
              >
                <option value="">Sélectionner un véhicule...</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.displayName} — {v.registration} ({v.capacity} places)
                  </option>
                ))}
              </select>
            )}
            {errors.vehicleId && <p role="alert" className="text-xs text-red-600">{errors.vehicleId}</p>}
          </div>

          {/* Date départ */}
          <Input
            label="Date et heure de départ"
            type="datetime-local"
            value={departureAt}
            onChange={(e) => { setDepartureAt(e.target.value); setErrors((p) => ({ ...p, departureAt: undefined })); }}
            error={errors.departureAt}
            required
            disabled={isSubmitting}
          />

          {/* Arrivée estimée (optionnel) */}
          <Input
            label="Arrivée estimée (optionnel)"
            type="datetime-local"
            value={arrivalEstimatedAt}
            onChange={(e) => setArrivalEstimatedAt(e.target.value)}
            disabled={isSubmitting}
          />

          {/* Notes */}
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

          {/* Bouton vert — action transactionnelle (créer = confirmer le trajet) */}
          <Button
            type="submit"
            variant="action"
            fullWidth
            isLoading={isSubmitting}
            disabled={isSubmitting || routes.length === 0 || vehicles.length === 0}
          >
            Créer le trajet
          </Button>
        </form>
      )}
    </div>
  );
}
