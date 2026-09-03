/**
 * Composant étoiles InsTRAM — lecture seule.
 *
 * Affiche de 1 à 5 étoiles.
 * Supporte les demi-étoiles (score arrondi au 0,5 le plus proche).
 * Compatible Server Components (pas de hooks).
 *
 * Charte graphique : étoiles en jaune (#FACC15) sur fond transparent.
 * NE PAS utiliser la couleur action (#9CC43D) — réservée aux boutons transactionnels.
 */

type StarState = 'full' | 'half' | 'empty';

interface StarRatingProps {
  /** Score de 0 à 5. Les décimales sont arrondies au 0,5 le plus proche. */
  score: number;
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  /** Label ARIA (ex. "Note : 3,5 sur 5") */
  label?: string;
  className?: string;
}

const sizeMap: Record<NonNullable<StarRatingProps['size']>, string> = {
  sm: 'w-3.5 h-3.5',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
};

function computeStars(score: number, max: number): StarState[] {
  // Arrondi au 0,5 le plus proche
  const rounded = Math.round(score * 2) / 2;
  return Array.from({ length: max }, (_, i) => {
    const threshold = i + 1;
    if (rounded >= threshold) return 'full';
    if (rounded >= threshold - 0.5) return 'half';
    return 'empty';
  });
}

function StarIcon({
  state,
  sizeClass,
}: {
  state: StarState;
  sizeClass: string;
}) {
  // Chemin SVG commun (étoile à 5 branches)
  const path =
    'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z';

  if (state === 'full') {
    return (
      <svg
        className={`${sizeClass} text-yellow-400 flex-shrink-0`}
        fill="currentColor"
        viewBox="0 0 20 20"
        aria-hidden="true"
      >
        <path d={path} />
      </svg>
    );
  }

  if (state === 'empty') {
    return (
      <svg
        className={`${sizeClass} text-gray-300 flex-shrink-0`}
        fill="currentColor"
        viewBox="0 0 20 20"
        aria-hidden="true"
      >
        <path d={path} />
      </svg>
    );
  }

  // Demi-étoile : moitié gauche jaune, moitié droite grise
  return (
    <svg
      className={`${sizeClass} flex-shrink-0`}
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      {/* Fond gris */}
      <path d={path} fill="#D1D5DB" />
      {/* Moitié gauche jaune via clip */}
      <clipPath id="half-clip">
        <rect x="0" y="0" width="10" height="20" />
      </clipPath>
      <path d={path} fill="#FACC15" clipPath="url(#half-clip)" />
    </svg>
  );
}

export function StarRating({
  score,
  max = 5,
  size = 'md',
  label,
  className = '',
}: StarRatingProps) {
  const stars = computeStars(score, max);
  const sizeClass = sizeMap[size];
  const ariaLabel =
    label ?? `${score.toFixed(1).replace('.', ',')} sur ${max}`;

  return (
    <div
      className={`flex items-center gap-0.5 ${className}`}
      role="img"
      aria-label={ariaLabel}
    >
      {stars.map((state, i) => (
        <StarIcon key={i} state={state} sizeClass={sizeClass} />
      ))}
    </div>
  );
}

export default StarRating;
