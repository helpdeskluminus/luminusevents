import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { RequireRole } from '@/components/RequireRole';
import { useLiveTick } from '@/hooks/useLiveTick';
import { Helmet } from 'react-helmet-async';
import { formatDateTime, formatTime } from '@/lib/format';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScanLine, CheckCircle2, Circle } from 'lucide-react';

interface RegRow {
  id: string;
  ticket_code: string;
  participants: { name: string; email: string; organization: string | null } | null;
}

const OcPanel = () => {
  const { profile } = useAuth();
  const tick = useLiveTick(['checkins', 'registrations']);
  const [competition, setCompetition] = useState<{ name: string; venue: string | null; start_time: string | null; capacity: number | null } | null>(null);
  const [registrations, setRegistrations] = useState<RegRow[]>([]);
  const [checkedIn, setCheckedIn] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');

  const competitionId = profile?.competition_id ?? null;

  const load = useCallback(async () => {
    if (!competitionId) return;
    const [{ data: comp }, { data: regs }, { data: checks }] = await Promise.all([
      supabase.from('competitions').select('name, venue, start_time, capacity').eq('id', competitionId).maybeSingle(),
      supabase.from('registrations').select('id, ticket_code, participants(name, email, organization)').eq('competition_id', competitionId).order('created_at'),
      supabase.from('checkins').select('registration_id, scanned_at').eq('competition_id', competitionId).eq('checkin_type', 'venue'),
    ]);
    setCompetition(comp ?? null);
    setRegistrations((regs as unknown as RegRow[]) ?? []);
    const map: Record<string, string> = {};
    (checks ?? []).forEach((c) => {
      const row = c as { registration_id: string; scanned_at: string };
      if (!map[row.registration_id]) map[row.registration_id] = row.scanned_at;
    });
    setCheckedIn(map);
  }, [competitionId]);

  useEffect(() => { void load(); }, [load, tick]);

  const filtered = registrations.filter((r) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (r.participants?.name ?? '').toLowerCase().includes(q)
      || (r.participants?.email ?? '').toLowerCase().includes(q)
      || r.ticket_code.toLowerCase().includes(q);
  });

  const inCount = Object.keys(checkedIn).length;

  if (!competitionId) {
    return (
      <main className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h1 className="font-heading text-2xl font-bold">No competition assigned</h1>
        <p className="mt-2 text-sm text-muted-foreground">Ask an admin to assign your account to a competition.</p>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <Helmet>
        <title>{`${competition?.name ?? 'My competition'} — Live Check-ins`}</title>
        <meta name="description" content="Event OC dashboard with a live registered list and venue check-in status for your competition." />
      </Helmet>

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">My competition</p>
          <h1 className="font-heading text-3xl font-bold tracking-tight mt-1">{competition?.name ?? '—'}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {competition?.venue ?? 'Venue TBA'} · {formatDateTime(competition?.start_time)}
          </p>
        </div>
        <Link to="/scan/venue">
          <Button className="rounded-full text-xs font-semibold tracking-wider"><ScanLine className="h-4 w-4 mr-1" /> OPEN SCANNER</Button>
        </Link>
      </div>

      <div className="grid sm:grid-cols-3 gap-4 mt-8">
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">REGISTERED</p>
          <p className="font-heading text-4xl font-bold mt-2">{registrations.length}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">CHECKED IN</p>
          <p className="font-heading text-4xl font-bold mt-2 text-primary">{inCount}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">CAPACITY</p>
          <p className="font-heading text-4xl font-bold mt-2">{competition?.capacity ?? '∞'}</p>
        </div>
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, email or ticket code"
        className="mt-8"
      />

      <div className="rounded-2xl border border-border bg-card mt-4 overflow-hidden">
        <ul className="divide-y divide-border">
          {filtered.map((r) => {
            const at = checkedIn[r.id];
            return (
              <li key={r.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.participants?.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{r.participants?.organization ?? '—'} · #{r.ticket_code}</p>
                </div>
                {at ? (
                  <span className="flex items-center gap-1.5 text-xs text-primary shrink-0">
                    <CheckCircle2 className="h-4 w-4" /> {formatTime(at)}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                    <Circle className="h-4 w-4" /> Not in
                  </span>
                )}
              </li>
            );
          })}
          {filtered.length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">No registrations found.</li>}
        </ul>
      </div>
    </main>
  );
};

const OcDashboard = () => (
  <RequireRole roles={['event_oc', 'admin']}>
    <OcPanel />
  </RequireRole>
);

export default OcDashboard;
