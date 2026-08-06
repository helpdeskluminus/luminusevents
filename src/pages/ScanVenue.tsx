import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { RequireRole } from '@/components/RequireRole';
import { QrScanner } from '@/components/QrScanner';
import { ScanResultCard, type ScanResult } from '@/components/ScanResultCard';
import { toast } from 'sonner';
import { Helmet } from 'react-helmet-async';
import { formatTime } from '@/lib/format';

interface LogEntry extends ScanResult {
  at: string;
}

const VenueScanner = () => {
  const { profile } = useAuth();
  const [competitionName, setCompetitionName] = useState<string | null>(null);
  const [current, setCurrent] = useState<ScanResult | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const lastToken = useRef<{ token: string; at: number }>({ token: '', at: 0 });

  useEffect(() => {
    if (!profile?.competition_id) return;
    supabase
      .from('competitions')
      .select('name, venue')
      .eq('id', profile.competition_id)
      .maybeSingle()
      .then(({ data }) => setCompetitionName(data?.name ?? null));
  }, [profile?.competition_id]);

  const handleScan = useCallback(async (token: string) => {
    const now = Date.now();
    if (token === lastToken.current.token && now - lastToken.current.at < 3000) return;
    lastToken.current = { token, at: now };

    setBusy(true);
    const { data, error } = await supabase.functions.invoke('scan-ticket', {
      body: { token, mode: 'venue', device_info: navigator.userAgent.slice(0, 120) },
    });
    setBusy(false);

    if (error) {
      toast.error('Scan failed. Check your connection and try again.');
      return;
    }
    const payload = data as ScanResult & { error?: string };
    if (payload.error) {
      toast.error(payload.error);
      return;
    }
    setCurrent(payload);
    setLog((prev) => [{ ...payload, at: new Date().toISOString() }, ...prev].slice(0, 25));
  }, []);

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <Helmet>
        <title>Venue Scanner | Techfest Check-in</title>
        <meta name="description" content="Event OC venue entrance scanner, locked to your assigned competition." />
      </Helmet>

      <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Venue entrance</p>
      <h1 className="font-heading text-3xl font-bold tracking-tight mt-1">{competitionName ?? 'Your competition'}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Only tickets registered for this competition are accepted.
      </p>

      {!profile?.competition_id && profile?.role === 'event_oc' && (
        <div className="mt-6 rounded-2xl border border-destructive bg-destructive/5 p-5 text-sm text-destructive">
          No competition is assigned to your account. Ask an admin to assign one.
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-8 mt-8">
        <QrScanner onScan={handleScan} paused={busy} />

        <div className="space-y-5">
          {current ? (
            <ScanResultCard result={current} />
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              Scan results will appear here.
            </div>
          )}

          {log.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground mb-3">RECENT SCANS</p>
              <ul className="divide-y divide-border">
                {log.map((entry, i) => (
                  <li key={i} className="py-2 flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">{entry.participant?.name ?? 'Unknown ticket'}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className={`text-[10px] font-semibold tracking-wider uppercase ${
                        entry.result === 'success' ? 'text-primary'
                          : entry.result === 'denied' ? 'text-destructive' : 'text-amber-600'}`}>
                        {entry.result}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatTime(entry.at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </main>
  );
};

const ScanVenue = () => (
  <RequireRole roles={['event_oc', 'admin']}>
    <VenueScanner />
  </RequireRole>
);

export default ScanVenue;
