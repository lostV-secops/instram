'use client';

/**
 * Formulaire de réservation walk-in (guichet).
 *
 * Flux en 3 étapes :
 *  1. Sélectionner un trajet (OPEN_FOR_BOOKING, aujourd'hui)
 *  2. Sélectionner les sièges disponibles
 *  3. Saisir les infos passager(s) + méthode de paiement
 *
 * RG-02 : platformFee = 0, commission = 0. L'UI ne présente aucun montant de
 * commission. POST /coop/bookings/walk-in gère cela côté backend.
 *
 * En cas d'erreur réseau (fréquent en 3G) : message explicite + retry possible.
 */

import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/Input';
import { PhoneInput } from '@/components/ui/PhoneInput';
import { Button } from '@/components/ui/Button';
import type { TripInstance, Seat, SeatCategory, City } from '@/lib/types';

// ─── Types locaux ─────────────────────────────────────────────────────────────

interface PassengerForm {
  firstName: string;
  lastName: string;
  phone: string;
  seatDefinitionId: string;
  seatCode: string;
}

type PaymentMethod = 'CASH' | 'MVOLA' | 'ORANGE_MONEY';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-MG', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const CATEGORY_LABELS: Record<SeatCategory, string> = {
  VIP: 'VIP',
  PREMIUM: 'Premium',
  CLASSIC: 'Classique',
  STANDARD: 'Standard',
};

// ─── Composant ────────────────────────────────────────────────────────────────

export function WalkInForm() {
  // ─── Villes ───────────────────────────────────────────────────────────────────
  const [cities, setCities] = useState<City[]>([]);
  const [originCityId, setOriginCityId] = useState('');
  const [destinationCityId, setDestinationCityId] = useState('');

  // Étape 1 : trajet
  const [trips, setTrips] = useState<Array<TripInstance & { routeName?: string }>>([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [tripsError, setTripsError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedTripId, setSelectedTripId] = useState('');

  // Étape 2 : sièges
  const [seats, setSeats] = useState<Seat[]>([]);
  const [seatsLoading, setSeatsLoading] = useState(false);
  const [seatsError, setSeatsError] = useState<string | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<Seat[]>([]);

  // Étape 3 : passagers + paiement
  const [passengers, setPassengers] = useState<PassengerForm[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [buyerPhone, setBuyerPhone] = useState('');

  // Soumission
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successRef, setSuccessRef] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [smsSending, setSmsSending] = useState(false);
  const [smsStatus, setSmsStatus] = useState<'idle' | 'sent' | 'error'>('idle');

  // ─── Charger les villes une seule fois ───────────────────────────────────────
  useEffect(() => {
    fetch('/api/proxy/v1/catalog/cities?limit=200', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setCities(d.items ?? []))
      .catch(() => {});
  }, []);

  // ─── Chercher les trajets (déclenché manuellement) ───────────────────────────
  const loadTrips = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const in30Days = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    setTripsLoading(true);
    setTripsError(null);
    setHasSearched(true);
    setSelectedTripId('');
    setSeats([]);
    setSelectedSeats([]);
    setPassengers([]);
    try {
      const params = new URLSearchParams({
        from: today,
        to: in30Days,
        status: 'OPEN_FOR_BOOKING',
        limit: '50',
      });
      if (originCityId) params.set('originCityId', originCityId);
      if (destinationCityId) params.set('destinationCityId', destinationCityId);
      const res = await fetch(`/api/proxy/v1/coop/trips?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTrips(data.items ?? []);
    } catch {
      setTripsError('Erreur de chargement des trajets. Vérifiez votre connexion.');
    } finally {
      setTripsLoading(false);
    }
  }, [originCityId, destinationCityId]);

  // ─── Charger les sièges quand un trajet est sélectionné ──────────────────────
  const loadSeats = async () => {
    if (!selectedTripId) return;
    setSeatsLoading(true);
    setSeatsError(null);
    setSeats([]);
    setSelectedSeats([]);
    setPassengers([]);
    try {
      const res = await fetch(
        `/api/proxy/v1/trips/${selectedTripId}/seats`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const available = (data.seats ?? []).filter(
        (s: Seat) => s.status === 'AVAILABLE',
      );
      setSeats(available);
    } catch {
      setSeatsError(
        'Impossible de charger les sièges. Vérifiez votre connexion.',
      );
    } finally {
      setSeatsLoading(false);
    }
  };

  // ─── Sélection / désélection d'un siège ─────────────────────────────────────
  const toggleSeat = (seat: Seat) => {
    setSelectedSeats((prev) => {
      const already = prev.find((s) => s.seatDefinitionId === seat.seatDefinitionId);
      if (already) {
        const updated = prev.filter((s) => s.seatDefinitionId !== seat.seatDefinitionId);
        setPassengers((p) => p.filter((_, i) => i < updated.length));
        return updated;
      }
      const updated = [...prev, seat];
      setPassengers((p) => {
        const filled = [...p];
        while (filled.length < updated.length) {
          filled.push({ firstName: '', lastName: '', phone: '', seatDefinitionId: '', seatCode: '' });
        }
        return filled;
      });
      return updated;
    });
  };

  // ─── Mise à jour passager ─────────────────────────────────────────────────────
  const updatePassenger = (
    index: number,
    field: keyof PassengerForm,
    value: string,
  ) => {
    setPassengers((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
    setSubmitError(null);
  };

  // ─── Soumission ───────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTripId || selectedSeats.length === 0) return;

    setSubmitError(null);
    setIsSubmitting(true);

    const passengersPayload = selectedSeats.map((seat, i) => ({
      firstName: passengers[i]?.firstName ?? '',
      lastName: passengers[i]?.lastName ?? '',
      phone: passengers[i]?.phone || undefined,
      seatCode: seat.code,
    }));

    const payload = {
      tripInstanceId: selectedTripId,
      seatDefinitionIds: selectedSeats.map((s) => s.seatDefinitionId),
      passengers: passengersPayload,
      paymentMethod,
      buyerPhone: buyerPhone || undefined,
      buyerLang: 'FR',
    };

    try {
      const res = await fetch('/api/proxy/v1/coop/bookings/walk-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.status === 409) {
        setSubmitError(
          'Un ou plusieurs sièges sélectionnés viennent d\'être pris. Veuillez recharger et choisir d\'autres sièges.',
        );
        return;
      }

      if (!res.ok) {
        let body: { message?: string } = {};
        try { body = await res.json(); } catch { /* ignore */ }
        throw new Error(body.message ?? `Erreur ${res.status}`);
      }

      const booking = await res.json();
      setSuccessRef(booking.reference ?? booking.id);
      setSuccessId(booking.id ?? null);
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

  // ─── Réinitialiser après succès ───────────────────────────────────────────────
  const handleResendSms = async () => {
    if (!successId) return;
    setSmsSending(true);
    setSmsStatus('idle');
    try {
      const res = await fetch(`/api/proxy/v1/coop/bookings/${successId}/resend-ticket`, { method: 'POST' });
      setSmsStatus(res.ok ? 'sent' : 'error');
    } catch {
      setSmsStatus('error');
    } finally {
      setSmsSending(false);
    }
  };

  const handleNewBooking = () => {
    setSuccessRef(null);
    setSuccessId(null);
    setSmsStatus('idle');
    setOriginCityId('');
    setDestinationCityId('');
    setTrips([]);
    setHasSearched(false);
    setSelectedTripId('');
    setSeats([]);
    setSelectedSeats([]);
    setPassengers([]);
    setBuyerPhone('');
    setPaymentMethod('CASH');
  };

  // ─── Succès ───────────────────────────────────────────────────────────────────
  if (successRef) {
    return (
      <div
        className="bg-green-50 border border-green-300 rounded-xl p-6 text-center space-y-4"
        role="status"
      >
        <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto">
          <svg className="w-6 h-6 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-green-800">Réservation enregistrée</h2>
        <p className="text-green-700">
          Référence : <span className="font-mono font-bold">{successRef}</span>
        </p>

        {/* Actions ticket */}
        <div className="flex flex-col gap-2 w-full max-w-xs mx-auto">
          {successId && (
            <a
              href={`/api/proxy/v1/coop/bookings/${successId}/ticket.pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-brand text-brand text-sm font-medium hover:bg-brand/5 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              Imprimer / voir le billet PDF
            </a>
          )}

          {successId && (
            <button
              type="button"
              onClick={handleResendSms}
              disabled={smsSending || smsStatus === 'sent'}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.12 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.64a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
              {smsSending ? 'Envoi…' : smsStatus === 'sent' ? 'SMS envoyé ✓' : 'Renvoyer le ticket par SMS'}
            </button>
          )}

          {smsStatus === 'error' && (
            <p className="text-red-600 text-xs text-center">Échec de l&apos;envoi SMS. Réessayez.</p>
          )}
        </div>

        {/* Bouton vert car action transactionnelle suivante */}
        <Button variant="action" onClick={handleNewBooking}>
          Nouvelle réservation
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* ─── Étape 1 : Trajet ──────────────────────────────────────────────────── */}
      <fieldset className="border border-gray-200 rounded-xl p-4 space-y-3">
        <legend className="px-2 text-sm font-semibold text-brand-dark">
          1. Rechercher un trajet
        </legend>

        {/* Filtres origine / destination */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="origin-city" className="text-xs font-medium text-gray-600">
              Ville de départ
            </label>
            <select
              id="origin-city"
              value={originCityId}
              onChange={(e) => setOriginCityId(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="">Toutes les villes</option>
              {[...cities].sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="dest-city" className="text-xs font-medium text-gray-600">
              Ville d'arrivée
            </label>
            <select
              id="dest-city"
              value={destinationCityId}
              onChange={(e) => setDestinationCityId(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="">Toutes les villes</option>
              {[...cities].sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={loadTrips}
          isLoading={tripsLoading}
          disabled={tripsLoading}
        >
          {tripsLoading ? 'Recherche en cours...' : 'Rechercher les trajets'}
        </Button>

        {tripsError && (
          <div role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg p-3">
            {tripsError}
          </div>
        )}

        {hasSearched && !tripsLoading && !tripsError && trips.length === 0 && (
          <p className="text-sm text-gray-500">Aucun trajet ouvert pour ces critères.</p>
        )}

        {!tripsLoading && trips.length > 0 && (
          <div className="space-y-2">
            <label htmlFor="trip-select" className="text-sm font-medium text-gray-800">
              Trajet <span className="text-red-500">*</span>
            </label>
            <select
              id="trip-select"
              value={selectedTripId}
              onChange={(e) => {
                setSelectedTripId(e.target.value);
                setSeats([]);
                setSelectedSeats([]);
                setPassengers([]);
              }}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
              required
            >
              <option value="">Sélectionner un départ...</option>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.route
                    ? `${t.route.originCity?.nameFr ?? '?'} → ${t.route.destinationCity?.nameFr ?? '?'}`
                    : (t.routeName ?? t.routeId)}{' '}
                  — {formatDateTime(t.departureAt)}
                </option>
              ))}
            </select>
          </div>
        )}

        {selectedTripId && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={loadSeats}
            isLoading={seatsLoading}
          >
            {seatsLoading ? 'Chargement...' : 'Charger les sièges'}
          </Button>
        )}
      </fieldset>

      {/* ─── Étape 2 : Sièges ──────────────────────────────────────────────────── */}
      {(seatsLoading || seatsError || seats.length > 0) && (
        <fieldset className="border border-gray-200 rounded-xl p-4 space-y-3">
          <legend className="px-2 text-sm font-semibold text-brand-dark">
            2. Sélectionner les sièges
          </legend>

          {seatsLoading && (
            <p className="text-sm text-gray-500 animate-pulse">Chargement des sièges...</p>
          )}

          {seatsError && (
            <div role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg p-3">
              {seatsError}
            </div>
          )}

          {!seatsLoading && seats.length === 0 && !seatsError && (
            <p className="text-sm text-gray-500">Aucun siège disponible pour ce trajet.</p>
          )}

          {seats.length > 0 && (
            <>
              <p className="text-xs text-gray-500">
                {selectedSeats.length} siège(s) sélectionné(s)
              </p>
              <div className="flex flex-wrap gap-2">
                {seats.map((seat) => {
                  const isSelected = selectedSeats.some(
                    (s) => s.seatDefinitionId === seat.seatDefinitionId,
                  );
                  return (
                    <button
                      key={seat.seatDefinitionId}
                      type="button"
                      onClick={() => toggleSeat(seat)}
                      aria-pressed={isSelected}
                      title={`${seat.code} — ${CATEGORY_LABELS[seat.category]}`}
                      className={[
                        'w-10 h-10 text-xs font-medium border-2 rounded-lg transition-colors duration-150',
                        'focus:outline-none focus:ring-2 focus:ring-brand',
                        isSelected
                          ? 'bg-brand text-white border-brand'
                          : 'bg-white text-brand border-brand hover:bg-brand/10',
                      ].join(' ')}
                    >
                      {seat.code}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </fieldset>
      )}

      {/* ─── Étape 3 : Passagers ───────────────────────────────────────────────── */}
      {selectedSeats.length > 0 && (
        <fieldset className="border border-gray-200 rounded-xl p-4 space-y-5">
          <legend className="px-2 text-sm font-semibold text-brand-dark">
            3. Informations passager(s)
          </legend>

          {selectedSeats.map((seat, i) => (
            <div
              key={seat.seatDefinitionId}
              className="border border-gray-100 rounded-lg p-3 space-y-3"
            >
              <p className="text-sm font-medium text-gray-700">
                Passager {i + 1} — Siège{' '}
                <span className="font-mono">{seat.code}</span>{' '}
                ({CATEGORY_LABELS[seat.category]})
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Prénom"
                  required
                  value={passengers[i]?.firstName ?? ''}
                  onChange={(e) => updatePassenger(i, 'firstName', e.target.value)}
                  autoComplete="given-name"
                  disabled={isSubmitting}
                />
                <Input
                  label="Nom"
                  required
                  value={passengers[i]?.lastName ?? ''}
                  onChange={(e) => updatePassenger(i, 'lastName', e.target.value)}
                  autoComplete="family-name"
                  disabled={isSubmitting}
                />
              </div>
              <PhoneInput
                label="Téléphone (optionnel, pour SMS billet)"
                value={passengers[i]?.phone ?? ''}
                onChange={(value) => updatePassenger(i, 'phone', value)}
                disabled={isSubmitting}
              />
            </div>
          ))}

          {/* Méthode de paiement */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-800">
              Méthode de paiement <span className="text-red-500">*</span>
            </p>
            <div className="flex flex-wrap gap-3">
              {(['CASH', 'MVOLA', 'ORANGE_MONEY'] as PaymentMethod[]).map((method) => (
                <label
                  key={method}
                  className={[
                    'flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm',
                    'transition-colors duration-150',
                    paymentMethod === method
                      ? 'border-brand bg-brand/5 text-brand font-medium'
                      : 'border-gray-300 text-gray-600 hover:border-brand',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value={method}
                    checked={paymentMethod === method}
                    onChange={() => setPaymentMethod(method)}
                    className="sr-only"
                  />
                  {method === 'CASH' ? 'Espèces' : method === 'MVOLA' ? 'MVola' : 'Orange Money'}
                </label>
              ))}
            </div>
          </div>

          {(paymentMethod === 'MVOLA' || paymentMethod === 'ORANGE_MONEY') && (
            <PhoneInput
              label="Téléphone de l'acheteur (pour SMS de confirmation)"
              value={buyerPhone}
              onChange={setBuyerPhone}
              disabled={isSubmitting}
            />
          )}
        </fieldset>
      )}

      {/* ─── Erreur de soumission ─────────────────────────────────────────────── */}
      {submitError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-300 text-red-700 rounded-lg px-4 py-3 text-sm"
        >
          {submitError}
        </div>
      )}

      {/* ─── Bouton submit — vert car action transactionnelle ────────────────── */}
      {selectedSeats.length > 0 && (
        <Button
          type="submit"
          variant="action"
          fullWidth
          isLoading={isSubmitting}
          disabled={
            isSubmitting ||
            !selectedTripId ||
            selectedSeats.length === 0 ||
            passengers.some((p) => !p.firstName.trim() || !p.lastName.trim())
          }
        >
          {isSubmitting ? 'Enregistrement en cours...' : 'Enregistrer la réservation'}
        </Button>
      )}
    </form>
  );
}

export default WalkInForm;
