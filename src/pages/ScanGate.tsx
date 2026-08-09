import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RequireRole } from '@/components/RequireRole';
import { QrScanner } from '@/components/QrScanner';
import { ScanResultCard, type ScanResult } from '@/components/ScanResultCard';
import { toast } from 'sonner';
import { Helmet } from 'react-helmet-async';
import { formatTime } from '@/lib/format';

interface LogEntry extends ScanResult {
  at: string;
}

const GateScanner = () => {
  const [current, setCurrent] = useState<ScanResult | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
  const lastToken = useRef<{ token: string; at: number }>({ token: '', at: 0 });

  const handleScan = useCallback(async (token: string) => {
    const now = Date.now();
    if (token === lastToken.current.token && now - lastToken.current.at < 3000) return;
    lastToken.current = { token, at: now };

    setBusy(true);
    // Camera scans decode to the signed QR token (contains a '.'); manual entry
    // uses the short TF-XXXXXXXX ticket code printed on the ticket/email instead.
    const isTicketCode = !token.includes('.');
    const { data, error } = await supabase.functions.invoke('scan-ticket', {
      body: {
        ...(isTicketCode ? { ticket_code: token } : { token }),
        mode: 'gate',
        device_info: navigator.userAgent.slice(0, 120),
      },
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

  const handleMarkExit = useCallback(async (registrationId: string) => {
    setExitBusy(true);
    const wasInside = current?.currently_inside !== false;
    const { data, error } = await supabase.functions.invoke('mark-exit', {
      body: { registration_id: registrationId, action: wasInside ? 'exit' : 'reentry' },
    });
    setExitBusy(false);
    const payload = data as { error?: string; currently_inside?: boolean } | null;
    if (error || payload?.error) return toast.error(payload?.error ?? 'Could not update status');
    toast.success(wasInside ? 'Marked as exited' : 'Marked as re-entered');
    setCurrent((c) => (c ? { ...c, currently_inside: payload?.currently_inside ?? !wasInside } : c));
  }, [current]);

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <Helmet>
        <title>Main Gate Scanner | Techfest Check-in</title>
        <meta name="description" content="Gate staff QR scanner for techfest entry and exit verification." />
      </Helmet>

      <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">Main gate</p>
      <h1 className="font-heading text-3xl font-bold tracking-tight mt-1">Entry scanner</h1>
      <p className="mt-2 text-sm text-muted-foreground">Scan a participant's ticket QR to record fest entry, or mark them exited below.</p>

      <div className="grid lg:grid-cols-2 gap-8 mt-8">
        <QrScanner onScan={handleScan} paused={busy} />

        <div className="space-y-5">
          {current ? (
            <ScanResultCard result={current} showCompetitions onMarkExit={handleMarkExit} markExitBusy={exitBusy} />
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

const ScanGate = () => (
  <RequireRole roles={['disciplinary', 'admin', 'gate_staff']}>
    <GateScanner />
  </RequireRole>
);

export default ScanGate;
