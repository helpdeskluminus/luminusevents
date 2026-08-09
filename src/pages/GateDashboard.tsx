import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RequireRole } from '@/components/RequireRole';
import { useLiveTick } from '@/hooks/useLiveTick';
import { Helmet } from 'react-helmet-async';
import { formatTime } from '@/lib/format';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ScanLine, LogOut, LogIn } from 'lucide-react';

interface ScanRow {
  id: string;
  scanned_at: string;
  is_duplicate: boolean;
  registration_id: string;
  registrations: {
    ticket_code: string;
    currently_inside: boolean;
    participants: { name: string; organization: string | null } | null;
  } | null;
}

const GatePanel = () => {
  const tick = useLiveTick(['checkins', 'registrations']);
  const [totalEntries, setTotalEntries] = useState(0);
  const [occupancy, setOccupancy] = useState(0);
  const [recent, setRecent] = useState<ScanRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ count: entries }, { count: inside }, { data }] = await Promise.all([
      supabase.from('checkins').select('*', { count: 'exact', head: true }).eq('checkin_type', 'main_gate').eq('is_duplicate', false),
      supabase.from('registrations').select('*', { count: 'exact', head: true }).eq('currently_inside', true),
      supabase
        .from('checkins')
        .select('id, scanned_at, is_duplicate, registration_id, registrations(ticket_code, currently_inside, participants(name, organization))')
        .eq('checkin_type', 'main_gate')
        .order('scanned_at', { ascending: false })
        .limit(30),
    ]);
    setTotalEntries(entries ?? 0);
    setOccupancy(inside ?? 0);
    setRecent((data as unknown as ScanRow[]) ?? []);
  }, []);

  useEffect(() => { void load(); }, [load, tick]);

  const toggleExit = async (registrationId: string, currentlyInside: boolean) => {
    setBusyId(registrationId);
    const { data, error } = await supabase.functions.invoke('mark-exit', {
      body: { registration_id: registrationId, action: currentlyInside ? 'exit' : 'reentry' },
    });
    setBusyId(null);
    const payload = data as { error?: string } | null;
    if (error || payload?.error) return toast.error(payload?.error ?? 'Could not update status');
    toast.success(currentlyInside ? 'Marked as exited' : 'Marked as re-entered');
    void load();
  };

  return (
    <main className="max-w-4xl mx-auto px-6 py-10">
      <Helmet>
        <title>Main Gate Live Count | Techfest Check-in</title>
        <meta name="description" content="Live main gate occupancy, entries, and recent scan log for gate staff." />
      </Helmet>

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Main gate</p>
          <h1 className="font-heading text-3xl font-bold tracking-tight mt-1">Live occupancy</h1>
        </div>
        <Link to="/scan/gate">
          <Button className="rounded-full text-xs font-semibold tracking-wider"><ScanLine className="h-4 w-4 mr-1" /> OPEN SCANNER</Button>
        </Link>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mt-8">
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">CURRENTLY INSIDE</p>
          <p className="font-heading text-7xl font-bold mt-3">{occupancy}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">TOTAL ENTRIES TODAY</p>
          <p className="font-heading text-7xl font-bold mt-3 text-primary">{totalEntries}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card mt-8 overflow-hidden">
        <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground p-5 pb-3">RECENT SCANS · TAP TO MARK EXIT/RE-ENTRY</p>
        <ul className="divide-y divide-border">
          {recent.map((r) => {
            const inside = r.registrations?.currently_inside ?? false;
            return (
              <li key={r.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.registrations?.participants?.name ?? 'Unknown'}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {r.registrations?.participants?.organization ?? '—'} · #{r.registrations?.ticket_code}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    {r.is_duplicate && <span className="text-[10px] font-semibold tracking-wider text-amber-600 uppercase block">Duplicate</span>}
                    <span className="text-xs text-muted-foreground">{formatTime(r.scanned_at)}</span>
                  </div>
                  {r.registration_id && (
                    <Button
                      size="sm"
                      variant={inside ? 'outline' : 'ghost'}
                      disabled={busyId === r.registration_id}
                      onClick={() => toggleExit(r.registration_id, inside)}
                      className="rounded-full text-[10px] font-semibold tracking-wider"
                    >
                      {inside ? <><LogOut className="h-3.5 w-3.5 mr-1" /> MARK EXIT</> : <><LogIn className="h-3.5 w-3.5 mr-1" /> MARK IN</>}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
          {recent.length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">No scans yet.</li>}
        </ul>
      </div>
    </main>
  );
};

const GateDashboard = () => (
  <RequireRole roles={['disciplinary', 'admin', 'gate_staff']}>
    <GatePanel />
  </RequireRole>
);

export default GateDashboard;
