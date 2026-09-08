import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getTranslations, isValidLang } from '@/lib/i18n';
import { apiGet } from '@/lib/api';
import { COOKIE_USER_INFO, parseUserInfoCookie } from '@/lib/auth';
import type { Me } from '@/lib/types';

interface ProfilePageProps {
  params: { lang: string };
}

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  if (!isValidLang(params.lang)) return {};
  const t = getTranslations(params.lang);
  return { title: t.profile.title };
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { lang } = params;
  if (!isValidLang(lang)) return null;

  const cookieStore = cookies();
  const userInfo = parseUserInfoCookie(cookieStore.get(COOKIE_USER_INFO)?.value);
  if (!userInfo) {
    redirect(`/${lang}/auth/login?redirectTo=/${lang}/profile`);
  }

  const t = getTranslations(lang);

  let me: Me | null = null;
  try {
    me = await apiGet<Me>('/auth/me', { cache: 'no-store' });
  } catch {
    // L'utilisateur est authentifié (cookie présent) mais l'appel a échoué
  }

  const firstName = me?.traveler?.firstName ?? '';
  const lastName = me?.traveler?.lastName ?? '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || null;

  const roleLabel = (role: string): string => {
    const key = `role${role}` as keyof typeof t.profile;
    return (t.profile[key] as string | undefined) ?? role;
  };

  return (
    <div className="max-w-lg mx-auto py-4">
      {/* En-tête */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-14 h-14 rounded-full bg-brand-dark flex items-center justify-center text-white text-2xl font-bold select-none">
          {firstName ? firstName[0].toUpperCase() : '?'}
        </div>
        <div>
          <h1 className="text-xl font-bold text-brand-dark">
            {fullName ?? t.profile.notSet}
          </h1>
          {me?.roles && me.roles.length > 0 && (
            <p className="text-sm text-gray-500">
              {me.roles.map(roleLabel).join(' · ')}
            </p>
          )}
        </div>
      </div>

      {/* Informations personnelles */}
      <section className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-100 mb-4">
        <div className="px-4 py-3">
          <p className="text-xs font-semibold text-brand uppercase tracking-wider mb-1">
            {t.profile.travelerSection}
          </p>
        </div>

        <ProfileRow label={t.profile.name} value={fullName} fallback={t.profile.notSet} />
        <ProfileRow label={t.profile.email} value={me?.email} fallback={t.profile.notSet} />
        <ProfileRow label={t.profile.phone} value={me?.phone} fallback={t.profile.notSet} />
        {me?.traveler?.mobileMoneyPhone && (
          <ProfileRow label={t.profile.mobileMoneyPhone} value={me.traveler.mobileMoneyPhone} fallback={t.profile.notSet} />
        )}
        <ProfileRow
          label={t.profile.lang}
          value={me?.preferredLang === 'mg' ? t.profile.langMg : t.profile.langFr}
          fallback={t.profile.langFr}
        />
      </section>

      {/* Actions */}
      <div className="flex flex-col gap-3">
        <Link
          href={`/${lang}/bookings`}
          className="block w-full text-center bg-brand text-white font-medium rounded-xl px-4 py-3 hover:bg-brand-dark transition-colors"
        >
          {t.profile.myBookings}
        </Link>

        <form action="/api/auth/logout" method="POST">
          <button
            type="submit"
            className="w-full text-center border border-gray-300 text-gray-700 font-medium rounded-xl px-4 py-3 hover:bg-gray-50 transition-colors"
          >
            {t.common.logout}
          </button>
        </form>
      </div>
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
