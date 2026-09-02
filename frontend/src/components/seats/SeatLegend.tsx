/**
 * Légende de la carte des sièges.
 * Server ou Client Component (pas d'état).
 */

import type { Translations } from '@/lib/i18n';

interface SeatLegendProps {
  t: Translations;
}

const legendItems = [
  {
    key: 'available' as const,
    color: 'bg-white border-2 border-brand',
    textColor: 'text-gray-700',
  },
  {
    key: 'heldByMe' as const,
    color: 'bg-brand-light border-2 border-brand',
    textColor: 'text-white',
  },
  {
    key: 'held' as const,
    color: 'bg-gray-200 border-2 border-gray-300',
    textColor: 'text-gray-400',
  },
  {
    key: 'sold' as const,
    color: 'bg-red-500 border-2 border-red-600',
    textColor: 'text-white',
  },
] as const;

export function SeatLegend({ t }: SeatLegendProps) {
  return (
    <div className="flex flex-wrap gap-3 mt-4" role="list" aria-label="Légende des sièges">
      {legendItems.map(({ key, color, textColor }) => (
        <div key={key} className="flex items-center gap-1.5" role="listitem">
          <div
            className={`w-7 h-7 rounded flex items-center justify-center text-xs ${color} ${textColor}`}
            aria-hidden="true"
          >
            1A
          </div>
          <span className="text-xs text-gray-600">{t.seats.legend[key]}</span>
        </div>
      ))}
    </div>
  );
}

export default SeatLegend;
