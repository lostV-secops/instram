import { apiGet } from '@/lib/api';
import { getTranslations, isValidLang } from '@/lib/i18n';
import { ProfileEditor } from '@/app/[lang]/(public)/profile/ProfileEditor';
import type { Me } from '@/lib/types';

interface PageProps {
  params: { lang: string };
}

export default async function CoopProfilePage({ params }: PageProps) {
  const { lang } = params;
  if (!isValidLang(lang)) return null;

  const t = getTranslations(lang);

  let me: Me | null = null;
  try {
    me = await apiGet<Me>('/auth/me', { cache: 'no-store' });
  } catch {
    // Affiche un état dégradé si l'API est indisponible
  }

  const firstName = me?.traveler?.firstName ?? '';
  const lastName  = me?.traveler?.lastName  ?? '';
  const fullName  = [firstName, lastName].filter(Boolean).join(' ') || null;

  const roleLabel = (role: string): string => {
    const key = `role${role}` as keyof typeof t.profile;
    return (t.profile[key] as string | undefined) ?? role;
  };

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl font-bold text-brand-dark">
        {lang === 'mg' ? 'Ny mombamomba anao' : 'Mon profil'}
      </h1>

      {/* Avatar + rôles */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-brand-dark flex items-center justify-center text-white text-2xl font-bold select-none">
          {firstName ? firstName[0].toUpperCase() : '?'}
        </div>
        <div>
          <p className="text-lg font-semibold text-gray-900">
            {fullName ?? t.profile.notSet}
          </p>
          {me?.roles && me.roles.length > 0 && (
            <p className="text-sm text-gray-500">
              {me.roles.map(roleLabel).join(' · ')}
            </p>
          )}
        </div>
      </div>

      {/* Informations */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-100">
        <div className="px-4 py-3">
          <p className="text-xs font-semibold text-brand uppercase tracking-wider">
            {t.profile.travelerSection}
          </p>
        </div>
        <ProfileRow label={t.profile.name}             value={fullName}                     fallback={t.profile.notSet} />
        <ProfileRow label={t.profile.email}            value={me?.email}                    fallback={t.profile.notSet} />
        <ProfileRow label={t.profile.phone}            value={me?.phone}                    fallback={t.profile.notSet} />
        {me?.traveler?.mobileMoneyPhone && (
          <ProfileRow label={t.profile.mobileMoneyPhone} value={me.traveler.mobileMoneyPhone} fallback={t.profile.notSet} />
        )}
        <ProfileRow
          label={t.profile.lang}
          value={me?.preferredLang === 'mg' ? t.profile.langMg : t.profile.langFr}
          fallback={t.profile.langFr}
        />
      </section>

      {/* Éditeur */}
      {me && <ProfileEditor me={me} lang={lang} />}

      {/* Déconnexion */}
      <form action="/api/auth/logout" method="POST">
        <button
          type="submit"
          className="w-full text-center border border-gray-300 text-gray-700 font-medium rounded-xl px-4 py-3 hover:bg-gray-50 transition-colors"
        >
          {t.common.logout}
        </button>
      </form>
    </div>
  );
}

function ProfileRow({
  label,
  value,
  fallback,
}: {
  label: string;
  value: string | null | undefined;
  fallback: string;
}) {
  return (
    <div className="px-4 py-3 flex justify-between items-center gap-3">
      <span className="text-sm text-gray-500 shrink-0">{label}</span>
      <span className={`text-sm font-medium text-right ${value ? 'text-gray-900' : 'text-gray-400 italic'}`}>
        {value ?? fallback}
      </span>
    </div>
  );
}
