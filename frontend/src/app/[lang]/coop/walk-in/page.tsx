/**
 * Page walk-in guichet — /[lang]/coop/walk-in
 *
 * Server Component : reçoit params.lang pour les traductions.
 * RG-02 : Réservation gratuite (PlatformFee = 0, Commission = 0).
 */

import { getTranslations } from '@/lib/i18n';
import { WalkInForm } from '@/components/coop/WalkInForm';

export default function WalkInPage({ params }: { params: { lang: string } }) {
  const t = getTranslations(params.lang);

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-brand-dark">
          {t.coop.walkIn.title}
        </h1>
      </div>
      <WalkInForm />
    </div>
  );
}
