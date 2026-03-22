import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Navbar } from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Upload, Download, CheckCircle, AlertTriangle, HelpCircle, XCircle, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';

interface ParsedSupabaseRow {
  team_id?: string;
  expected_fee: number;
  participants: any[];
}

interface ParsedBillDeskRow {
  email: string;
  phone: string;
  name: string;
  amount: number;
  event: string;
  matched: boolean;
}

interface FinalParticipant {
  name: string;
  email: string;
  phone: string;
  usn: string;
  college: string;
  event: string;
  track: string;
  amount_paid: number;
  expected_fee: number;
  status: string;
  match_confidence: number;
  matched_by: string;
}

const AdminReconciliation = () => {
  const { user, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [supabaseFile, setSupabaseFile] = useState<File | null>(null);
  const [billdeskFile, setBilldeskFile] = useState<File | null>(null);
  const [results, setResults] = useState<FinalParticipant[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Stats
  const [stats, setStats] = useState({
    totalRegistrations: 0,
    totalPayments: 0,
    pendingPayments: 0,
    revenue: 0,
    eventRevenue: {} as Record<string, number>
  });

  useEffect(() => {
    if (!loading && !user) navigate('/auth', { replace: true });
    if (!loading && user && profile && profile.role !== 'admin') navigate('/', { replace: true });
  }, [user, profile, loading, navigate]);

  const normalizeString = (str: any) => String(str || '').trim().toLowerCase();
  const normalizePhone = (str: any) => String(str || '').replace(/[^\d+]/g, '');

  const readExcel = async (file: File): Promise<any[]> => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
  };

  const getVal = (row: any, keys: string[], keywords: string[]) => {
    const key = keys.find(k => keywords.some(kw => k.toLowerCase().includes(kw)));
    return key ? row[key] : '';
  };

  const processFiles = async () => {
    if (!supabaseFile || !billdeskFile) {
      toast({ title: 'Files required', description: 'Please upload both files.', variant: 'destructive' });
      return;
    }

    setIsProcessing(true);
    try {
      // 1. Parse BillDesk
      const bdData = await readExcel(billdeskFile);
      const bdRows: ParsedBillDeskRow[] = bdData.map(row => {
        // Find columns dynamically
        const keys = Object.keys(row);

        const email = normalizeString(getVal(row, keys, ['email', 'mail']));
        const phone = normalizePhone(getVal(row, keys, ['phone', 'mobile', 'contact']));
        const name = normalizeString(getVal(row, keys, ['name', 'participant']));
        const amountStr = getVal(row, keys, ['amount', 'fee', 'paid']);
        const amount = parseFloat(String(amountStr).replace(/[^\d.-]/g, '')) || 0;
        const event = normalizeString(getVal(row, keys, ['event']));

        return { email, phone, name, amount, event, matched: false };
      });

      // 2. Parse Supabase
      const sbData = await readExcel(supabaseFile);
      const sbRows: ParsedSupabaseRow[] = sbData.map(row => {
        let participants = [];
        const keys = Object.keys(row);
        const pKey = keys.find(k => k.toLowerCase().includes('participant'));
        if (pKey && row[pKey]) {
          try {
            participants = typeof row[pKey] === 'string' ? JSON.parse(row[pKey]) : row[pKey];
            if (!Array.isArray(participants)) participants = [participants];
          } catch (e) {
            console.warn('Failed to parse participants JSON', e);
          }
        }
        
        // If it isn't an array of JSON, maybe it's flattened
        if (participants.length === 0) {
          const email = getVal(row, keys, ['email']);
          const name = getVal(row, keys, ['name']);
          if (email || name) {
             participants = [{
                name: getVal(row, keys, ['name']),
                email: getVal(row, keys, ['email']),
                phone: getVal(row, keys, ['phone', 'mobile']),
                usn: getVal(row, keys, ['usn']),
                college: getVal(row, keys, ['college', 'institution']),
                track: getVal(row, keys, ['track']),
                event: getVal(row, keys, ['event'])
             }];
          }
        }

        const feeKey = keys.find(k => k.toLowerCase().includes('fee') || k.toLowerCase().includes('amount') || k.toLowerCase().includes('total'));
        const expected_fee = feeKey ? parseFloat(String(row[feeKey]).replace(/[^\d.-]/g, '')) || 0 : 0;
        
        return { participants, expected_fee };
      });

      // 3. TEAM-BASED MATCHING & Flattening
      const flattened: FinalParticipant[] = [];
      let totReg = 0;
      let totPay = 0;
      let pendPay = 0;
      let rev = 0;
      const evRev: Record<string, number> = {};

      sbRows.forEach(team => {
        if (!team.participants || team.participants.length === 0) return;

        // Try to find a matching BillDesk row for the team
        let bestMatch: ParsedBillDeskRow | null = null;
        let matchConfidence = 0;
        let matchedBy = '';

        for (const p of team.participants) {
          const pEmail = normalizeString(p.email);
          const pPhone = normalizePhone(p.phone);
          const pName = normalizeString(p.name);

          const exactEmailMatch = bdRows.find(b => !b.matched && b.email && b.email === pEmail);
          if (exactEmailMatch) { bestMatch = exactEmailMatch; matchConfidence = 100; matchedBy = 'Email'; break; }

          const exactPhoneMatch = bdRows.find(b => !b.matched && b.phone && b.phone === pPhone);
          if (exactPhoneMatch) { bestMatch = exactPhoneMatch; matchConfidence = 90; matchedBy = 'Phone'; break; }

          const fuzzyNameMatch = bdRows.find(b => !b.matched && b.name && pName && (b.name.includes(pName) || pName.includes(b.name)));
          if (fuzzyNameMatch && matchConfidence < 70) { bestMatch = fuzzyNameMatch; matchConfidence = 70; matchedBy = 'Fuzzy Name'; }
        }

        let amount_paid = 0;
        let status = 'NOT PAID';

        if (bestMatch) {
          bestMatch.matched = true;
          amount_paid = bestMatch.amount;
          if (amount_paid >= team.expected_fee && team.expected_fee > 0) {
            status = 'PAID';
          } else if (team.expected_fee === 0) {
            status = amount_paid > 0 ? 'REVIEW REQUIRED' : 'NOT PAID'; // Free event? Or missing expected_fee?
          } else {
            status = 'AMOUNT MISMATCH';
          }
        }

        // Output flattened participants
        let teamParticipantsTotal = team.participants.length || 1;
        team.participants.forEach(p => {
          let eventName = String(p.event || p.event_name || bestMatch?.event || 'Unknown Event');
          
          flattened.push({
            name: p.name || '',
            email: p.email || '',
            phone: p.phone || '',
            usn: p.usn || '',
            college: p.college || '',
            event: eventName,
            track: p.track || p.track_name || '',
            amount_paid: amount_paid / teamParticipantsTotal, 
            expected_fee: team.expected_fee / teamParticipantsTotal,
            status: status,
            match_confidence: matchConfidence,
            matched_by: matchedBy
          });

          totReg++;
        });

        if (status === 'PAID' || status === 'AMOUNT MISMATCH') {
          totPay++;
          rev += amount_paid;
          const evName = bestMatch?.event || 'Unknown Event';
          evRev[evName] = (evRev[evName] || 0) + amount_paid;
        } else {
          pendPay++;
        }
      });

      setResults(flattened);
      setStats({
        totalRegistrations: totReg,
        totalPayments: totPay,
        pendingPayments: pendPay,
        revenue: rev,
        eventRevenue: evRev
      });

      toast({ title: 'Processing Complete', description: `Matched ${flattened.length} participants.` });
    } catch (error) {
      toast({ title: 'Processing Error', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const exportResults = () => {
    if (results.length === 0) return;
    const worksheet = XLSX.utils.json_to_sheet(results.map(r => ({
      Name: r.name,
      Email: r.email,
      Phone: r.phone,
      USN: r.usn,
      College: r.college,
      Event: r.event,
      Track: r.track,
      'Amount Paid': r.amount_paid,
      'Expected Fee': r.expected_fee,
      Status: r.status,
      'Match Confidence %': r.match_confidence,
      'Matched By': r.matched_by
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reconciliation');
    XLSX.writeFile(workbook, 'Reconciliation_Report.xlsx');
  };

  const syncToDatabase = async () => {
    if (results.length === 0) return;
    setIsProcessing(true);
    try {
      // Create a map of events and tracks to IDs
      const { data: events } = await supabase.from('events').select('id, name');
      const { data: tracks } = await supabase.from('tracks').select('id, name, event_id');
      
      const validParticipants = results.filter(r => r.status === 'PAID' || r.status === 'REVIEW REQUIRED');
      
      if (validParticipants.length === 0) {
        toast({ title: 'No valid participants', description: 'Only PAID participants can be synced.' });
        setIsProcessing(false);
        return;
      }

      const toInsert = validParticipants.map(r => {
        // Find matching event ID (fuzzy)
        const ev = events?.find(e => normalizeString(e.name).includes(normalizeString(r.event)) || normalizeString(r.event).includes(normalizeString(e.name)));
        const tr = tracks?.find(t => t.event_id === ev?.id && (normalizeString(t.name).includes(normalizeString(r.track)) || normalizeString(r.track).includes(normalizeString(t.name))));
        
        return {
          name: r.name,
          email: r.email || null,
          phone: r.phone || null,
          usn: r.usn || null,
          college: r.college || null,
          event_id: ev?.id || '',
          track_id: tr?.id || null,
          amount_paid: r.amount_paid,
          payment_status: r.status,
          qr_token: crypto.randomUUID(),
          checked_in: false,
          checked_in_at: null
        };
      }).filter(p => p.event_id !== '');

      if (toInsert.length === 0) {
        throw new Error('Could not match any participants to existing Events in the database. Please ensure Event names match.');
      }

      for (let i = 0; i < toInsert.length; i += 500) {
         const { error } = await supabase.from('participants').insert(toInsert.slice(i, i + 500));
         if (error) throw error;
      }

      toast({ title: 'Sync Complete', description: `Successfully inserted ${toInsert.length} participants into the database.` });
    } catch (err) {
      toast({ title: 'Sync Error', description: err instanceof Error ? err.message : 'Failed to sync', variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const getStatusIcon = (status: string) => {
    if (status === 'PAID') return <CheckCircle className="h-4 w-4 text-success" />;
    if (status === 'NOT PAID') return <XCircle className="h-4 w-4 text-destructive" />;
    if (status === 'AMOUNT MISMATCH') return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    return <HelpCircle className="h-4 w-4 text-primary" />;
  };

  if (loading || (user && !profile)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!profile || profile.role !== 'admin') return null;

  return (
    <div className="min-h-screen bg-background">
      <Navbar profile={profile} onSignOut={signOut} />
      
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            <span className="bordered-text">Smart</span>{' '}
            <span className="highlight-text">Reconciliation</span>
          </h1>
          <p className="text-sm text-muted-foreground font-body mt-3">
            Upload Supabase exports and BillDesk reports to automatically match payments and generate verified participant lists.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* File Uploads */}
          <div className="p-6 rounded-xl border border-border bg-card space-y-6">
            <div>
              <h3 className="text-sm font-semibold tracking-wider text-foreground uppercase mb-3 flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-primary" /> 1. Supabase Export (JSON format)
              </h3>
              <div className="relative border-2 border-dashed border-border hover:border-primary/50 transition-colors rounded-xl p-6 text-center">
                <input 
                  type="file" 
                  accept=".csv,.xlsx"
                  onChange={e => setSupabaseFile(e.target.files?.[0] || null)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="flex flex-col items-center gap-2 pointer-events-none">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm font-semibold text-foreground">{supabaseFile ? supabaseFile.name : 'Click or drag file here'}</p>
                  <p className="text-xs text-muted-foreground font-body">CSV or Excel containing 'participants' JSON array</p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold tracking-wider text-foreground uppercase mb-3 flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-success" /> 2. BillDesk Report
              </h3>
              <div className="relative border-2 border-dashed border-border hover:border-success/50 transition-colors rounded-xl p-6 text-center">
                <input 
                  type="file" 
                  accept=".csv,.xlsx"
                  onChange={e => setBilldeskFile(e.target.files?.[0] || null)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="flex flex-col items-center gap-2 pointer-events-none">
                  <Upload className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm font-semibold text-foreground">{billdeskFile ? billdeskFile.name : 'Click or drag file here'}</p>
                  <p className="text-xs text-muted-foreground font-body">BillDesk transaction CSV or Excel</p>
                </div>
              </div>
            </div>

            <Button 
                onClick={processFiles} 
                disabled={isProcessing || !supabaseFile || !billdeskFile}
                className="w-full h-12 rounded-full text-sm font-semibold tracking-wider"
            >
              {isProcessing ? 'PROCESSING...' : 'RUN MATCHING ENGINE'}
            </Button>
          </div>

          {/* Analytics Summary */}
          <div className="p-6 rounded-xl border border-border bg-secondary/20">
            <h3 className="text-sm font-semibold tracking-wider text-foreground uppercase mb-5">Matching Analytics</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-card border border-border">
                <p className="text-3xl font-bold text-foreground">{stats.totalRegistrations}</p>
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mt-1">Total Registrations</p>
              </div>
              <div className="p-4 rounded-lg bg-card border border-border">
                <p className="text-3xl font-bold text-success">{stats.totalPayments}</p>
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mt-1">Valid Payments</p>
              </div>
              <div className="p-4 rounded-lg bg-card border border-border">
                <p className="text-3xl font-bold text-destructive">{stats.pendingPayments}</p>
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mt-1">Pending / Unmatched</p>
              </div>
              <div className="p-4 rounded-lg bg-card border border-border">
                <p className="text-3xl font-bold text-primary">₹{stats.revenue}</p>
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mt-1">Total Matched Revenue</p>
              </div>
            </div>
            
            {Object.keys(stats.eventRevenue).length > 0 && (
              <div className="mt-6">
                <h4 className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase mb-3">Revenue By Event</h4>
                <div className="space-y-2">
                  {Object.entries(stats.eventRevenue).map(([ev, rev]) => (
                    <div key={ev} className="flex justify-between items-center p-2 rounded bg-background border border-border">
                      <span className="text-xs font-medium font-body">{ev}</span>
                      <span className="text-xs font-bold text-success">₹{rev}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Results Data Grid */}
        {results.length > 0 && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold tracking-wider text-foreground uppercase">Reconciliation Output</h3>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={exportResults} className="rounded-full text-xs font-semibold tracking-wider gap-2">
                  <Download className="h-4 w-4" /> EXPORT EXCEL
                </Button>
                <Button size="sm" onClick={syncToDatabase} disabled={isProcessing} className="rounded-full text-xs font-semibold tracking-wider gap-2 bg-success hover:bg-success/90 text-success-foreground">
                  <CheckCircle className="h-4 w-4" /> SYNC VERIFIED TO DB
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-border overflow-hidden bg-card">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-secondary/50">
                    <tr>
                      <th className="px-4 py-3 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Name</th>
                      <th className="px-4 py-3 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Email</th>
                      <th className="px-4 py-3 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Phone</th>
                      <th className="px-4 py-3 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Event / Track</th>
                      <th className="px-4 py-3 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Fee / Paid</th>
                      <th className="px-4 py-3 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Status</th>
                      <th className="px-4 py-3 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Match Info</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-body">
                    {results.slice(0, 100).map((r, i) => (
                      <tr key={i} className="hover:bg-secondary/30 transition-colors">
                        <td className="px-4 py-3 text-xs font-medium text-foreground">{r.name || '—'}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{r.email || '—'}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{r.phone || '—'}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                           <div className="font-medium">{r.event || '—'}</div>
                           <div className="text-[10px]">{r.track}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                           ₹{r.expected_fee} / <span className={r.amount_paid >= r.expected_fee ? 'text-success font-semibold' : 'text-destructive font-semibold'}>₹{r.amount_paid}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider">
                            {getStatusIcon(r.status)}
                            <span className={r.status === 'PAID' ? 'text-success' : r.status === 'NOT PAID' ? 'text-destructive' : 'text-amber-500'}>
                              {r.status}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[10px] text-muted-foreground">
                          {r.match_confidence > 0 ? (
                            <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">
                              {r.match_confidence}% ({r.matched_by})
                            </span>
                          ) : 'No match'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {results.length > 100 && (
                <div className="p-3 text-center text-xs text-muted-foreground font-body bg-secondary/10 border-t border-border">
                  Showing first 100 rows. Export to Excel to view all {results.length} rows.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminReconciliation;
