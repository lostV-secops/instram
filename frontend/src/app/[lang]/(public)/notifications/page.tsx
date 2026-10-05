'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useTranslations } from '@/components/TranslationsProvider';

type NotifStatus = 'PENDING' | 'SCHEDULED' | 'SENT' | 'FAILED';
type NotifCategory = 'TRANSACTIONAL' | 'REMINDER';

interface NotifItem {
  id: string;
  channel: string;
  category: NotifCategory;
  lang: string;
  status: NotifStatus;
  templateCode: string;
  payload: Record<string, string>;
  scheduledFor: string | null;
  sentAt: string | null;
  failedAt: string | null;
  createdAt: string;
}

interface NotifPrefs {
  smsEnabled: boolean;
  optedOutTemplates: string[];
}

const STATUS_VARIANTS: Record<NotifStatus, 'success' | 'warning' | 'error' | 'neutral'> = {
  PENDING: 'warning',
  SCHEDULED: 'warning',
  SENT: 'success',
  FAILED: 'error',
};

const TEMPLATE_LABELS: Record<string, string> = {
  BOOKING_CONFIRMED: 'Réservation confirmée',
  BOOKING_CANCELLED: 'Réservation annulée',
  PAYMENT_SUCCESS: 'Paiement réussi',
  PAYMENT_FAILED: 'Paiement échoué',
  TRIP_REMINDER: 'Rappel de départ',
  TICKET_RESEND: 'Billet renvoyé',
  COOP_INVITE: 'Invitation coopérative',
  OTP: 'Code de vérification',
  PASSWORD_RESET: 'Réinitialisation mot de passe',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-MG', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function NotificationsPage() {
  const t = useTranslations();
  const tn = t.notifications;

  const [items, setItems] = useState<NotifItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [prefs, setPrefs] = useState<NotifPrefs | null>(null);
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsError, setPrefsError] = useState<string | null>(null);

  const loadItems = useCallback(async (append = false, cursor?: string) => {
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const url = `/api/proxy/v1/notifications${cursor ? `?cursor=${cursor}&limit=20` : '?limit=20'}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { items: NotifItem[]; nextCursor: string | null };
      setItems((prev) => append ? [...prev, ...data.items] : data.items);
      setNextCursor(data.nextCursor);
    } catch {
      setError(t.common.errorNetwork);
    } finally {
      if (append) setLoadingMore(false); else setLoading(false);
    }
  }, []);

  const loadPrefs = useCallback(async () => {
    setPrefsLoading(true);
    try {
      const res = await fetch('/api/proxy/v1/notifications/preferences', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      setPrefs(await res.json() as NotifPrefs);
    } catch {
      // Silent fail — prefs are non-critical
    } finally {
      setPrefsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
    loadPrefs();
  }, [loadItems, loadPrefs]);

  const handleToggleSms = async () => {
    if (!prefs) return;
    setPrefsSaving(true);
    setPrefsError(null);
    const updated = { ...prefs, smsEnabled: !prefs.smsEnabled };
    try {
      const res = await fetch('/api/proxy/v1/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smsEnabled: updated.smsEnabled }),
      });
      if (!res.ok) throw new Error();
      setPrefs(await res.json() as NotifPrefs);
    } catch {
      setPrefsError(tn.prefsError);
    } finally {
      setPrefsSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-xl font-bold text-brand-dark">{tn.title}</h1>

      {/* Preferences */}
      {!prefsLoading && prefs && (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-800">{tn.smsTitle}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {prefs.smsEnabled ? tn.smsEnabledDesc : tn.smsDisabledDesc}
            </p>
          </div>
          <Button
            variant={prefs.smsEnabled ? 'secondary' : 'primary'}
            size="sm"
            isLoading={prefsSaving}
            onClick={handleToggleSms}
          >
            {prefs.smsEnabled ? tn.disable : tn.enable}
          </Button>
        </div>
      )}
      {prefsError && (
        <p className="text-sm text-red-600">{prefsError}</p>
      )}

      {/* List */}
      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 animate-pulse text-center">
          <p className="text-sm text-gray-400">{t.common.loading}</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 text-sm">
          {error}
          <button type="button" onClick={() => loadItems()} className="block underline mt-1">
            {t.common.retry}
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-12 text-center text-sm text-gray-500">
          {tn.empty}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <div
              key={n.id}
              className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-start justify-between gap-3"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium text-gray-900">
                  {TEMPLATE_LABELS[n.templateCode] ?? n.templateCode}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span>{fmtDate(n.createdAt)}</span>
                  <span className="text-gray-300">·</span>
                  <span>{tn.categories[n.category]}</span>
                  {n.scheduledFor && n.status === 'SCHEDULED' && (
                    <>
                      <span className="text-gray-300">·</span>
                      <span>{tn.scheduledFor} {fmtDate(n.scheduledFor)}</span>
                    </>
                  )}
                  {n.sentAt && (
                    <>
                      <span className="text-gray-300">·</span>
                      <span>{tn.sentAt} {fmtDate(n.sentAt)}</span>
                    </>
                  )}
                </div>
              </div>
              <Badge variant={STATUS_VARIANTS[n.status]}>
                {tn.statuses[n.status]}
              </Badge>
            </div>
          ))}

          {nextCursor && (
            <div className="text-center pt-2">
              <Button
                variant="secondary"
                size="sm"
                isLoading={loadingMore}
                onClick={() => loadItems(true, nextCursor)}
              >
                {tn.loadMore}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
