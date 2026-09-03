/**
 * Affichage étoiles — composant lecture seule.
 *
 * Props :
 *   rating : number (0–5). Arrondi au 0,5 le plus proche (demi-étoiles).
 *   size   : 'sm' | 'md' | 'lg'  (taille en pixels)
 *   label  : chaîne ARIA optionnelle
 *
 * Charte graphique InsTRAM :
 *   Étoiles remplies → #205E98  (bleu brand — jamais vert)
 *   Étoiles vides    → #E5E7EB  (gris clair)
 *
 * Implémentation :
 *   SVG inline — aucune image externe (contrainte 3G).
 *   Demi-étoile via CSS clip-path polygon — pas d'ID SVG (évite les conflits
 *   quand plusieurs composants sont rendus sur la même page).
 *   Compatible Server Component.
 */

type StarState = 'full' | 'half' | 'empty';

export interface RatingStarsProps {
  rating: number;
  size?: 'sm' | 'md' | 'lg';
  /** Chaîne ARIA. Défaut : "X,X sur 5". */
  label?: string;
  className?: string;
}

const PX: Record<NonNullable<RatingStarsProps['size']>, number> = {
  sm: 14,
  md: 18,
  lg: 24,
};

const STAR_PATH =
  'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z';

function computeStars(rating: number): StarState[] {
  const clamped = Math.max(0, Math.min(5, rating));
  const rounded = Math.round(clamped * 2) / 2;
  return Array.from({ length: 5 }, (_, i) => {
    const threshold = i + 1;
    if (rounded >= threshold) return 'full';
    if (rounded >= threshold - 0.5) return 'half';
    return 'empty';
  });
}

function StarSvg({ state, px }: { state: StarState; px: number }) {
  if (state === 'full') {
    return (
      <svg
        width={px}
        height={px}
        viewBox="0 0 20 20"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        <path d={STAR_PATH} fill="#205E98" />
      </svg>
    );
  }

  if (state === 'empty') {
    return (
      <svg
        width={px}
        height={px}
        viewBox="0 0 20 20"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        <path d={STAR_PATH} fill="#E5E7EB" />
      </svg>
    );
  }

  // Demi-étoile : clip CSS polygon — pas d'ID SVG pour éviter les conflits
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 20 20"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {/* Fond vide */}
      <path d={STAR_PATH} fill="#E5E7EB" />
      {/* Moitié gauche bleue via CSS clip-path (pas d'ID, pas de conflit) */}
      <path
        d={STAR_PATH}
        fill="#205E98"
        style={{ clipPath: 'polygon(0 0, 50% 0, 50% 100%, 0 100%)' }}
      />
    </svg>
  );
}

export function RatingStars({
  rating,
  size = 'md',
  label,
  className = '',
}: RatingStarsProps) {
  const stars = computeStars(rating);
  const px = PX[size];
  const ariaLabel = label ?? `${rating.toFixed(1).replace('.', ',')} sur 5`;

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={`flex items-center gap-0.5 ${className}`}
    >
      {stars.map((state, i) => (
        <StarSvg key={i} state={state} px={px} />
      ))}
    </div>
  );
}

export default RatingStars;
