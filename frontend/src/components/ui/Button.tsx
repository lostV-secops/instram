/**
 * Composant Button InsTRAM.
 *
 * Variantes :
 *  - 'primary'  → bleu #205E98  — navigation, actions principales
 *  - 'secondary'→ bleu clair #4596D7 — actions secondaires
 *  - 'action'   → VERT #9CC43D  — EXCLUSIVEMENT Réserver / Payer / Confirmer
 *  - 'ghost'    → contour, pas de fond — actions tertiaires
 *  - 'danger'   → rouge — actions destructives (admin uniquement)
 *
 * RÈGLE GRAPHIQUE : 'action' (vert) ne doit jamais être utilisé pour
 * la navigation ou la décoration. Uniquement pour les boutons transactionnels.
 */

import { type ButtonHTMLAttributes, forwardRef } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'action' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  fullWidth?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-white hover:bg-brand-dark focus:ring-brand disabled:bg-brand/50',
  secondary:
    'bg-brand-light text-white hover:bg-brand focus:ring-brand-light disabled:bg-brand-light/50',
  // VERT TRANSACTIONNEL — ne PAS utiliser pour autre chose que Réserver/Payer/Confirmer
  action:
    'bg-action text-white hover:bg-[#7ea82e] focus:ring-action disabled:bg-action/50 font-semibold',
  ghost:
    'bg-transparent text-brand border-2 border-brand hover:bg-brand hover:text-white focus:ring-brand disabled:opacity-50',
  danger:
    'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 disabled:bg-red-400',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-5 py-2.5 text-base',
  lg: 'px-6 py-3 text-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      fullWidth = false,
      children,
      className = '',
      disabled,
      ...props
    },
    ref,
  ) {
    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-busy={isLoading}
        className={[
          'inline-flex items-center justify-center gap-2',
          'rounded-lg font-medium',
          'transition-colors duration-150',
          'focus:outline-none focus:ring-2 focus:ring-offset-2',
          'disabled:cursor-not-allowed',
          variantClasses[variant],
          sizeClasses[size],
          fullWidth ? 'w-full' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...props}
      >
        {isLoading && (
          <svg
            className="animate-spin h-4 w-4 flex-shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  },
);

export default Button;
