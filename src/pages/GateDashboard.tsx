import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RequireRole } from '@/components/RequireRole';
import { useLiveTick } from '@/hooks/useLiveTick';
import { Helmet } from 'react-helmet-async';
import { formatTime } from '@/lib/format';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ScanLine } from 'lucide-react';

interface ScanRow {
  id: string;
  scanned_at: string;
  is_duplicate: boolean;
  registrations: { ticket_code: string; participants: { name: string; organization: string | null } | null } | null;
}

const GatePanel = () => {
  const tick = useLiveTick(['checkins']);
  const [total, setTotal] = useState(0);
  const [recent, setRecent] = useState<ScanRow[]>([]);

  const load = useCallback(async () => {
    const [{ count }, { data }] = await Promise.all([
      supabase.from('checkins').select('*', { count: 'exact', head: true }).eq('checkin_type', 'main_gate').eq('is_duplicate', false),
      supabase
        .from('checkins')
        .select('id, scanned_at, is_duplicate, registrations(ticket_code, participants(name, organization))')
        .eq('checkin_type', 'main_gate')
        .order('scanned_at', { ascending: false })
        .limit(30),
    ]);
    setTotal(count ?? 0);
    setRecent((data as unknown as ScanRow[]) ?? []);
  }, []);

  useEffect(() => { void load(); }, [load, tick]);

  return (
    <main className="max-w-4xl mx-auto px-6 py-10">
      <Helmet>
        <title>Main Gate Live Count | Techfest Check-in</title>
        <meta name="description" content="Live main gate entry count and recent scan log for disciplinary staff." />
      </Helmet>

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Main gate</p>
          <h1 className="font-heading text-3xl font-bold tracking-tight mt-1">Live entry count</h1>
        </div>
        <Link to="/scan/gate">
          <Button className="rounded-full text-xs font-semibold tracking-wider"><ScanLine className="h-4 w-4 mr-1" /> OPEN SCANNER</Button>
        </Link>
      </div>

      <div className="rounded-2xl border border-border bg-card p-10 mt-8 text-center">
        <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">TOTAL PEOPLE INSIDE</p>
        <p className="font-heading text-7xl font-bold mt-3">{total}</p>
      </div>

      <div className="rounded-2xl border border-border bg-card mt-8 overflow-hidden">
        <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground p-5 pb-3">RECENT SCANS</p>
        <ul className="divide-y divide-border">
          {recent.map((r) => (
            <li key={r.id} className="px-5 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{r.registrations?.participants?.name ?? 'Unknown'}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {r.registrations?.participants?.organization ?? '—'} · #{r.registrations?.ticket_code}
                </p>
              </div>
              <div className="text-right shrink-0">
                {r.is_duplicate && <span className="text-[10px] font-semibold tracking-wider text-amber-600 uppercase block">Duplicate</span>}
                <span className="text-xs text-muted-foreground">{formatTime(r.scanned_at)}</span>
              </div>
            </li>
          ))}
          {recent.length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">No scans yet.</li>}
        </ul>
      </div>
    </main>
  );
};

const GateDashboard = () => (
  <RequireRole roles={['disciplinary', 'admin']}>
    <GatePanel />
  </RequireRole>
);

export default GateDashboard;
