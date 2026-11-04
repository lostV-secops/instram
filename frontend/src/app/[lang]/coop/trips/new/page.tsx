'use client';

/**
 * Créer un trajet — /[lang]/coop/trips/new
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCoop } from '../../CoopContext';
import { getTranslations } from '@/lib/i18n';
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
  const { lang } = useCoop();
  const t = getTranslations(lang);

  const [routes, setRoutes] = useState<CoopRouteDetail[]>([]);
  const [vehicles, setVehicles] = useState<CoopVehicle[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  const [routeId, setRouteId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [departureAt, setDepartureAt] = useState('');
  const [notesFr, setNotesFr] = useState('');

  // Heure d'arrivée calculée automatiquement d'après la durée de la ligne
  const selectedRoute = routes.find((r) => r.id === routeId) ?? null;
  const arrivalEstimatedAt = (() => {
    if (!departureAt || !selectedRoute?.estimatedDurationMin) return null;
    return new Date(new Date(departureAt).getTime() + selectedRoute.estimatedDurationMin * 60 * 1000);
  })();

  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
        setLoadError(t.coop.trips.new.loadError);
      } finally {
        setDataLoading(false);
      }
    };
    load();
  }, [t.coop.trips.new.loadError]);

  const validate = (): boolean => {
    const newErrors: FormErrors = {};
    if (!routeId) newErrors.routeId = t.coop.trips.new.selectRoute;
    if (!vehicleId) newErrors.vehicleId = t.coop.trips.new.selectVehicle;
    if (!departureAt) newErrors.departureAt = t.coop.trips.new.departureAt;
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
      // arrivalEstimatedAt calculé côté backend depuis route.estimatedDurationMin ;
      // on ne l'envoie pas depuis le formulaire.
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
      router.push(`/${lang}/coop/trips/${trip.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(
        msg.toLowerCase().includes('fetch')
          ? t.common.errorNetwork
          : `Erreur : ${msg}`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center gap-3">
        <Link href={`/${lang}/coop/trips`} className="text-brand text-sm hover:underline">
          ← {t.coop.trips.title}
        </Link>
      </div>

      <h1 className="text-xl font-bold text-brand-dark">{t.coop.trips.new.title}</h1>

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
              {t.coop.routes.title} <span className="text-red-500">*</span>
            </label>
            {routes.length === 0 ? (
              <p className="text-sm text-orange-600">
                {t.coop.trips.new.errorNoRoutes}{' '}
                <Link href={`/${lang}/coop/routes/new`} className="underline">{t.coop.routes.new.title}</Link>
              </p>
            ) : (
              <select
                id="route-select"
                value={routeId}
                onChange={(e) => { setRouteId(e.target.value); setErrors((p) => ({ ...p, routeId: undefined })); }}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
                aria-invalid={!!errors.routeId}
              >
                <option value="">{t.coop.trips.new.selectRoute}...</option>
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
              {t.coop.nav.vehicles} <span className="text-red-500">*</span>
            </label>
            {vehicles.length === 0 ? (
              <p className="text-sm text-orange-600">{t.coop.trips.new.errorNoVehicles}</p>
            ) : (
              <select
                id="vehicle-select"
                value={vehicleId}
                onChange={(e) => { setVehicleId(e.target.value); setErrors((p) => ({ ...p, vehicleId: undefined })); }}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
                aria-invalid={!!errors.vehicleId}
              >
                <option value="">{t.coop.trips.new.selectVehicle}...</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.displayName} — {v.registration} ({v.capacity} {t.coop.vehicles.places})
                  </option>
                ))}
              </select>
            )}
            {errors.vehicleId && <p role="alert" className="text-xs text-red-600">{errors.vehicleId}</p>}
          </div>

          <Input
            label={t.coop.trips.new.departureAt}
            type="datetime-local"
            value={departureAt}
            onChange={(e) => { setDepartureAt(e.target.value); setErrors((p) => ({ ...p, departureAt: undefined })); }}
            error={errors.departureAt}
            required
            disabled={isSubmitting}
          />

          {/* Arrivée estimée — calculée automatiquement, non modifiable */}
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-gray-800">
              {t.coop.trips.new.arrivalEstimatedAt}
            </span>
            {arrivalEstimatedAt ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-base text-gray-700">
                {arrivalEstimatedAt.toLocaleString('fr-MG', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
                {selectedRoute?.estimatedDurationMin && (
                  <span className="ml-2 text-xs text-gray-400">
                    ({Math.floor(selectedRoute.estimatedDurationMin / 60)}h
                    {selectedRoute.estimatedDurationMin % 60 > 0
                      ? `${selectedRoute.estimatedDurationMin % 60}min`
                      : ''}{' '}
                    de trajet)
                  </span>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2.5 text-sm text-gray-400">
                {routeId && !selectedRoute?.estimatedDurationMin
                  ? 'Durée non renseignée sur la ligne — à définir dans la fiche route'
                  : 'Calculée après sélection de la ligne et de l\'heure de départ'}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="notes" className="text-sm font-medium text-gray-800">{t.coop.trips.new.notesFr}</label>
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

          <Button
            type="submit"
            variant="action"
            fullWidth
            isLoading={isSubmitting}
            disabled={isSubmitting || routes.length === 0 || vehicles.length === 0}
          >
            {t.coop.trips.new.submit}
          </Button>
        </form>
      )}
    </div>
  );
}
