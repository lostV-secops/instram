/**
 * Carte KPI pour le tableau de bord coopérative.
 * Server Component — pas d'interactivité requise.
 */

interface StatsCardProps {
  label: string;
  value: string | number;
  /** Sous-label ou description complémentaire */
  sub?: string;
  /** Icône SVG inline (optionnel) */
  icon?: React.ReactNode;
}

export function StatsCard({ label, value, sub, icon }: StatsCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-3">
      {icon && (
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-brand/10 flex items-center justify-center text-brand">
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <p className="text-sm text-gray-500 truncate">{label}</p>
        <p className="text-2xl font-bold text-brand-dark tabular-nums leading-tight">
          {value}
        </p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default StatsCard;
