/**
 * Champ téléphone malgache — préfixe +261 fixe et non effaçable.
 * L'utilisateur saisit uniquement la partie locale (ex. 34 00 000 00).
 * La valeur émise via onChange est toujours au format E.164 : "+261XXXXXXXXX"
 * ou une chaîne vide si le champ est vide.
 */

import { useId, type InputHTMLAttributes } from 'react';

const PREFIX = '+261';

interface PhoneInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  label: string;
  /** Valeur complète avec préfixe ("+261XXXXXXXXX") ou chaîne vide */
  value: string;
  /** Appelé avec la valeur complète "+261..." ou "" */
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  showLabel?: boolean;
}

export function PhoneInput({
  label,
  value,
  onChange,
  error,
  hint,
  showLabel = true,
  className = '',
  id: idProp,
  required,
  disabled,
  ...props
}: PhoneInputProps) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  // Partie locale affichée dans le champ (sans le +261)
  const localValue = value.startsWith(PREFIX) ? value.slice(PREFIX.length) : value;

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, '');
    onChange(digits ? `${PREFIX}${digits}` : '');
  }

  const describedBy = [error ? errorId : null, hint ? hintId : null]
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
        {required && (
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

      <div
        className={[
          'flex items-center rounded-lg border overflow-hidden',
          'transition-colors duration-150',
          'focus-within:ring-2 focus-within:ring-offset-1',
          error
            ? 'border-red-500 focus-within:ring-red-400'
            : 'border-gray-300 focus-within:border-brand focus-within:ring-brand',
          disabled ? 'bg-gray-50' : 'bg-white',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span
          className="pl-3 pr-2 py-2.5 text-base text-gray-500 select-none shrink-0 border-r border-gray-200"
          aria-hidden="true"
        >
          +261
        </span>
        <input
          ref={undefined}
          id={id}
          type="tel"
          inputMode="numeric"
          value={localValue}
          onChange={handleChange}
          disabled={disabled}
          required={required}
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : undefined}
          placeholder="34 00 000 00"
          className={[
            'flex-1 px-3 py-2.5 text-base text-gray-900 placeholder-gray-400 bg-transparent',
            'focus:outline-none',
            'disabled:text-gray-500 disabled:cursor-not-allowed',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          {...props}
        />
      </div>

      {error && (
        <p id={errorId} role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export default PhoneInput;
