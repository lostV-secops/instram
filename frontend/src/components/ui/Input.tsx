/**
 * Composant Input accessible pour InsTRAM.
 * Respecte WCAG AA : label visible associé via htmlFor, description d'erreur
 * liée via aria-describedby.
 */

import { type InputHTMLAttributes, forwardRef, useId } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
  /** Afficher le label (true par défaut) — si false, le label est visually-hidden */
  showLabel?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input(
    { label, error, hint, showLabel = true, className = '', id: idProp, ...props },
    ref,
  ) {
    const generatedId = useId();
    const id = idProp ?? generatedId;
    const errorId = `${id}-error`;
    const hintId = `${id}-hint`;

    const describedBy = [
      error ? errorId : null,
      hint ? hintId : null,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div className="flex flex-col gap-1">
        <label
          htmlFor={id}
          className={[
            'text-sm font-medium text-gray-800',
            !showLabel && 'sr-only',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {label}
          {props.required && (
            <span className="text-red-500 ml-1" aria-hidden="true">
              *
            </span>
          )}
        </label>

        {hint && (
          <p id={hintId} className="text-xs text-gray-500">
            {hint}
          </p>
        )}

        <input
          ref={ref}
          id={id}
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : undefined}
          className={[
            'block w-full rounded-lg border px-3 py-2.5',
            'text-base text-gray-900 placeholder-gray-400',
            'transition-colors duration-150',
            'focus:outline-none focus:ring-2 focus:ring-offset-1',
            error
              ? 'border-red-500 focus:ring-red-400'
              : 'border-gray-300 focus:border-brand focus:ring-brand',
            'disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          {...props}
        />

        {error && (
          <p id={errorId} role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  },
);

export default Input;
