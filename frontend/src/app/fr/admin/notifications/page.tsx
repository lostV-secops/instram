'use client';

/**
 * Gestion des templates de notifications SMS — /fr/admin/notifications
 *
 * Liste et édite les templates via :
 *   GET  /v1/admin/notifications/templates
 *   POST /v1/admin/notifications/templates
 *   PATCH /v1/admin/notifications/templates/:code
 *
 * Console admin InsTRAM — FR uniquement (CDC §5.6).
 */

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

const NOTIFICATION_CODES = [
  'BOOKING_CONFIRMED',
  'BOOKING_CANCELLED',
  'DEPARTURE_REMINDER',
  'PAYMENT_FAILED',
  'RATING_REQUEST',
  'TICKET_RESEND',
  'WALK_IN_CONFIRMED',
] as const;

type NotificationCode = (typeof NOTIFICATION_CODES)[number];

const CODE_LABELS: Record<NotificationCode, string> = {
  BOOKING_CONFIRMED: 'Confirmation réservation',
  BOOKING_CANCELLED: 'Annulation réservation',
  DEPARTURE_REMINDER: 'Rappel de départ',
  PAYMENT_FAILED: 'Paiement échoué',
  RATING_REQUEST: 'Demande de notation',
  TICKET_RESEND: 'Renvoi du billet',
  WALK_IN_CONFIRMED: 'Walk-in confirmé',
};

interface NotificationTemplate {
  id: string;
  code: NotificationCode;
  category: string;
  bodyFr: string;
  bodyMg: string;
  version: number;
  isActive: boolean;
  updatedAt: string;
}

export default function AdminNotificationsPage() {
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Édition
  const [editing, setEditing] = useState<NotificationTemplate | null>(null);
  const [creating, setCreating] = useState<NotificationCode | null>(null);
  const [formFr, setFormFr] = useState('');
  const [formMg, setFormMg] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/proxy/v1/admin/notifications/templates');
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      setTemplates(await res.json() as NotificationTemplate[]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function startEdit(t: NotificationTemplate) {
    setEditing(t);
    setCreating(null);
    setFormFr(t.bodyFr);
    setFormMg(t.bodyMg);
    setFormActive(t.isActive);
    setSaveError(null);
    setSaveSuccess(false);
  }

  function startCreate(code: NotificationCode) {
    setCreating(code);
    setEditing(null);
    setFormFr('');
    setFormMg('');
    setFormActive(true);
    setSaveError(null);
    setSaveSuccess(false);
  }

  function cancel() {
    setEditing(null);
    setCreating(null);
    setSaveError(null);
    setSaveSuccess(false);
  }

  async function save() {
    if (!formFr.trim() || !formMg.trim()) {
      setSaveError('Les deux versions (FR et MG) sont obligatoires');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      let res: Response;
      if (creating) {
        res = await fetch('/api/proxy/v1/admin/notifications/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: creating, bodyFr: formFr, bodyMg: formMg }),
        });
      } else if (editing) {
        res = await fetch(`/api/proxy/v1/admin/notifications/templates/${editing.code}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bodyFr: formFr, bodyMg: formMg, isActive: formActive }),
        });
      } else {
        return;
      }
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        throw new Error(data.message ?? `Erreur ${res.status}`);
      }
      setSaveSuccess(true);
      cancel();
      await load();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const existingCodes = new Set(templates.map((t) => t.code));
  const missingCodes = NOTIFICATION_CODES.filter((c) => !existingCodes.has(c));

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#162E49]">Templates SMS</h1>
        <p className="text-sm text-gray-500">
          {templates.length}/{NOTIFICATION_CODES.length} templates configurés
        </p>
      </div>

      {loading && <p className="text-gray-500">Chargement…</p>}
      {error && <p className="text-red-600">Erreur : {error}</p>}

      {/* Formulaire création / édition */}
      {(editing || creating) && (
        <div className="rounded-lg border border-[#205E98] bg-blue-50 p-4 space-y-4">
          <h2 className="text-sm font-semibold text-[#162E49]">
            {creating
              ? `Créer — ${CODE_LABELS[creating]}`
              : `Modifier — ${CODE_LABELS[editing!.code]} (v${editing!.version})`}
          </h2>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Message FR <span className="text-gray-400">(variables : {`{{ref}}`}, {`{{date}}`}, {`{{origin}}`}, {`{{destination}}`})</span>
            </label>
            <textarea
              rows={3}
              value={formFr}
              onChange={(e) => setFormFr(e.target.value)}
              maxLength={1000}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#205E98]"
              placeholder="Votre réservation {{ref}} est confirmée. Départ le {{date}} depuis {{origin}}."
            />
            <p className="text-xs text-gray-400 text-right">{formFr.length}/1000</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Message MG
            </label>
            <textarea
              rows={3}
              value={formMg}
              onChange={(e) => setFormMg(e.target.value)}
              maxLength={1000}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#205E98]"
              placeholder="Version malgache du message SMS…"
            />
            <p className="text-xs text-gray-400 text-right">{formMg.length}/1000</p>
          </div>

          {editing && (
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={formActive}
                onChange={(e) => setFormActive(e.target.checked)}
                className="w-4 h-4"
              />
              Template actif
            </label>
          )}

          {saveError && <p className="text-sm text-red-600">{saveError}</p>}
          {saveSuccess && <p className="text-sm text-green-600">Sauvegardé avec succès.</p>}

          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void save()} isLoading={saving} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
            <Button onClick={cancel} variant="ghost" className="text-sm px-4 py-2">
              Annuler
            </Button>
          </div>
        </div>
      )}

      {/* Templates existants */}
      {templates.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Templates configurés</h2>
          {templates.map((t) => (
            <div
              key={t.id}
              className="rounded-lg border border-gray-200 bg-white p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
            >
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm text-[#162E49]">
                    {CODE_LABELS[t.code] ?? t.code}
                  </span>
                  <Badge variant={t.isActive ? 'success' : 'neutral'}>
                    {t.isActive ? 'Actif' : 'Inactif'}
                  </Badge>
                  <Badge variant="neutral">v{t.version}</Badge>
                  <span className="text-xs text-gray-400">{t.category}</span>
                </div>
                <p className="text-xs text-gray-600 bg-gray-50 rounded px-2 py-1 font-mono">
                  FR : {t.bodyFr.length > 100 ? `${t.bodyFr.slice(0, 100)}…` : t.bodyFr}
                </p>
                <p className="text-xs text-gray-600 bg-gray-50 rounded px-2 py-1 font-mono">
                  MG : {t.bodyMg.length > 100 ? `${t.bodyMg.slice(0, 100)}…` : t.bodyMg}
                </p>
              </div>
              <Button
                onClick={() => startEdit(t)}
                variant="ghost"
                className="text-xs px-3 py-1.5 self-start"
              >
                Modifier
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Codes manquants */}
      {missingCodes.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">Templates manquants</h2>
          <p className="text-xs text-gray-500">Ces codes n'ont pas encore de template configuré.</p>
          <div className="flex flex-wrap gap-2">
            {missingCodes.map((code) => (
              <button
                key={code}
                onClick={() => startCreate(code)}
                className="flex items-center gap-1 rounded border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:border-[#205E98] hover:text-[#205E98] transition-colors"
              >
                <span>+</span>
                <span>{CODE_LABELS[code]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
