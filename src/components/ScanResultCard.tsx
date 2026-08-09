import { CheckCircle2, XCircle, AlertTriangle, Clock } from 'lucide-react';

export interface ScanResult {
  result: 'success' | 'duplicate' | 'denied' | 'debounced';
  reason?: string | null;
  participant?: { name: string; email?: string; organization?: string | null; ticket_code?: string } | null;
  competitions?: { name: string; venue: string | null; start_time: string | null }[];
  scan_count?: number | null;
  max_scans?: number | null;
}

const STYLES = {
  success: { icon: CheckCircle2, cls: 'border-primary bg-primary/5 text-primary', label: 'ENTRY ALLOWED' },
  duplicate: { icon: AlertTriangle, cls: 'border-amber-500 bg-amber-500/5 text-amber-600', label: 'DUPLICATE SCAN' },
  debounced: { icon: Clock, cls: 'border-muted-foreground bg-muted text-muted-foreground', label: 'JUST SCANNED' },
  denied: { icon: XCircle, cls: 'border-destructive bg-destructive/5 text-destructive', label: 'DENIED' },
} as const;

export const ScanResultCard = ({ result, showCompetitions }: { result: ScanResult; showCompetitions?: boolean }) => {
  const style = STYLES[result.result] ?? STYLES.denied;
  const Icon = style.icon;

  return (
    <div className={`rounded-2xl border-2 p-6 ${style.cls}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-6 w-6" />
        <span className="text-xs font-bold tracking-[0.2em]">{style.label}</span>
      </div>

      {result.participant?.name && (
        <p className="mt-4 font-heading text-2xl font-bold text-foreground">{result.participant.name}</p>
      )}
      {result.participant?.organization && (
        <p className="text-sm text-muted-foreground">{result.participant.organization}</p>
      )}
      {result.participant?.ticket_code && (
        <p className="mt-1 text-xs tracking-widest text-muted-foreground">#{result.participant.ticket_code}</p>
      )}
      {result.reason && <p className="mt-3 text-sm font-medium">{result.reason}</p>}
      {!!result.max_scans && (
        <p className="mt-1 text-xs font-semibold tracking-wide text-muted-foreground">
          SCAN {Math.min(result.scan_count ?? 0, result.max_scans)} OF {result.max_scans}
        </p>
      )}

      {showCompetitions && result.competitions && result.competitions.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground mb-2">REGISTERED FOR</p>
          <ul className="space-y-1">
            {result.competitions.map((c, i) => (
              <li key={i} className="text-sm text-foreground">
                {c.name}
                {c.venue && <span className="text-muted-foreground"> — {c.venue}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
