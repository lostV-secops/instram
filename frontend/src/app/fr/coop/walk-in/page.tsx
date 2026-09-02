/**
 * Page walk-in guichet — /fr/coop/walk-in
 *
 * Délègue au WalkInForm (Client Component).
 *
 * RG-02 : Réservation gratuite (PlatformFee = 0, Commission = 0).
 */

import { WalkInForm } from '@/components/coop/WalkInForm';

export default function WalkInPage() {
  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-brand-dark">
          Réservation guichet (Walk-in)
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Réservation gratuite — aucune commission, aucun frais plateforme (RG-02).
        </p>
      </div>
      <WalkInForm />
    </div>
  );
}
