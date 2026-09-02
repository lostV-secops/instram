'use client';

/**
 * Liste des membres de la coopérative — /fr/coop/members
 * GET /coop/members
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { MemberRow } from '@/components/coop/MemberRow';
import type { Member } from '@/lib/types';

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/proxy/v1/coop/members', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMembers(Array.isArray(data) ? data : []);
    } catch {
      setError('Erreur réseau. Vérifiez votre connexion et réessayez.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-brand-dark">Équipe</h1>
        <Link href="/fr/coop/members/invite">
          <Button variant="primary" size="sm">+ Inviter un membre</Button>
        </Link>
      </div>

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 animate-pulse text-center">
          <p className="text-sm text-gray-400">Chargement...</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-300 text-red-700 rounded-xl px-4 py-4 text-sm">
          {error}
          <button type="button" onClick={load} className="block underline mt-1">Réessayer</button>
        </div>
      ) : members.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-12 text-center text-sm text-gray-500">
          Aucun membre.{' '}
          <Link href="/fr/coop/members/invite" className="text-brand underline">Inviter le premier membre</Link>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[500px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Nom</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Contact</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Rôle</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Statut</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-gray-500 uppercase">Depuis</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <MemberRow key={m.id} member={m} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
