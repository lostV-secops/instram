/**
 * Carte KPI pour le tableau de bord admin InsTRAM.
 * Même structure que StatsCard coop — adapté au style admin.
 * Server Component compatible (pas d'interactivité).
 */

interface GlobalStatsCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ReactNode;
  /** Coloration d'accent : 'default' (bleu brand) | 'warning' | 'success' */
  accent?: 'default' | 'warning' | 'success';
}

const accentClasses: Record<string, string> = {
  default: 'bg-brand/10 text-brand',
  warning: 'bg-yellow-100 text-yellow-700',
  success: 'bg-green-100 text-green-700',
};

export function GlobalStatsCard({
  label,
  value,
  sub,
  icon,
  accent = 'default',
}: GlobalStatsCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-3">
      {icon && (
        <div
          className={[
            'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
            accentClasses[accent],
          ].join(' ')}
        >
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

export default GlobalStatsCard;
