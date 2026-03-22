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
  const normalize = (v: any) => String(v || '').toLowerCase().replace(/\s+/g, "");

  const readExcel = async (file: File): Promise<any[]> => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
  };

  const getField = (row: any, keys: string[]) => {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== "") return row[key];
    }
    return null;
  };

  const processFiles = async () => {
    if (!supabaseFile || !billdeskFile) {
      toast({ title: 'Files required', description: 'Please upload both files.', variant: 'destructive' });
      return;
    }

    setIsProcessing(true);
    try {
      // 1. Parse BillDesk & Filter Valid Payments
      const bdData = await readExcel(billdeskFile);
      const bdRows: ParsedBillDeskRow[] = bdData
        .filter(row => {
          const status = normalize(getField(row, ["status", "Status", "Transaction Status"]));
          // If status column doesn't match success, or isn't present, assume success if no status col?
          // Prompt strictly states: return status === "success"
          return status === "success";
        })
        .map(row => {
          const email = normalize(getField(row, ["email", "Email", "Email ID", "Customer Email", "Payer Email"]));
          const phone = normalize(getField(row, ["phone", "Phone", "Mobile", "Mobile No", "Contact Number"]));
          const amountStr = getField(row, ["amount", "Amount", "Txn Amount", "Transaction Amount"]);
          const amount = parseFloat(String(amountStr || '0').replace(/[^\d.-]/g, '')) || 0;

          return { email, phone, name: '', amount, event: '', matched: false };
        });

      // 2. Parse Supabase
      const sbData = await readExcel(supabaseFile);
      const sbRows: ParsedSupabaseRow[] = sbData.map(row => {
        let participants = [];
        try {
          // Parse JSON directly as specified
          if (row.participants) {
             participants = typeof row.participants === 'string' ? JSON.parse(row.participants) : row.participants;
             if (!Array.isArray(participants)) participants = [participants];
          } else {
             // fallback for generic row testing
             participants = [row];
          }
        } catch (e) {
          console.warn('Failed to parse participants JSON', e);
        }

        const expected_fee = Number(row.registration_fee || row.fee || row.amount || 0);
        
        return { 
           participants, 
           expected_fee,
           team_id: row.event_name || row.Event || '' 
        };
      });

      // 3. TEAM-BASED MATCHING & Flattening
      const flattened: FinalParticipant[] = [];
      let totReg = 0;
      let totPay = 0;
      let pendPay = 0;
      let rev = 0;
      const evRev: Record<string, number> = {};

      sbRows.forEach(teamRow => {
        if (!teamRow.participants || teamRow.participants.length === 0) return;

        const team = teamRow.participants;
        const firstParticipant = team[0];
        const event_name = teamRow.team_id || '';
        const expectedAmount = Number(teamRow.expected_fee);

        // 5. MATCHING LOGIC (Using ONLY first participant)
        const match = bdRows.find(b => 
          !b.matched && (
            (b.email && b.email === normalize(firstParticipant.email)) ||
            (b.phone && b.phone === normalize(firstParticipant.phoneNumber || firstParticipant.phone))
          )
        );

        let paidAmount = 0;
        if (match) {
          match.matched = true;
          paidAmount = match.amount;
        }

        // 8. STATUS LOGIC
        let status;
        if (!match) {
          status = "NOT PAID";
        } else if (paidAmount !== expectedAmount) {
          status = "AMOUNT MISMATCH";
        } else {
          status = "PAID";
        }

        // 10. DEBUG MODE
        console.log("First Participant:", firstParticipant);
        console.log("Matched Payment:", match);

        // 9. FINAL OUTPUT (Flatten team but attach same payment)
        team.forEach(p => {
          flattened.push({
            name: p.name || '',
            email: p.email || '',
            phone: p.phoneNumber || p.phone || '',
            usn: p.studentId || p.usn || '',
            college: p.collegeName || p.college || '',
            event: event_name,
            track: p.track || p.track_name || '',
            amount_paid: paidAmount, // User requested whole payment amount visible per participant
            expected_fee: expectedAmount,
            status: status,
            match_confidence: match ? 100 : 0,
            matched_by: match ? 'First Participant Match' : ''
          });

          totReg++;
        });

        if (status === 'PAID' || status === 'AMOUNT MISMATCH') {
          totPay++;
          rev += paidAmount;
          evRev[event_name] = (evRev[event_name] || 0) + paidAmount;
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

    const workbook = XLSX.utils.book_new();

    // 1. SUMMARY SHEET
    const summaryData = [
      { Metric: 'Total Participants', Value: stats.totalRegistrations },
      { Metric: 'Total Paid / Valid', Value: stats.totalPayments },
      { Metric: 'Total Pending / Not Paid', Value: stats.pendingPayments },
      { Metric: 'Total Revenue', Value: `₹${stats.revenue}` },
      ...Object.entries(stats.eventRevenue).map(([ev, rev]) => ({
        Metric: `Revenue: ${ev}`, Value: `₹${rev}`
      }))
    ];
    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

    // 2. GROUP BY EVENT
    const grouped: Record<string, FinalParticipant[]> = {};
    results.forEach(r => {
      const evName = r.event || 'Unknown Event';
      if (!grouped[evName]) grouped[evName] = [];
      grouped[evName].push(r);
    });

    // 3. CREATE SHEETS PER EVENT
    Object.keys(grouped).forEach(eventName => {
      const data = grouped[eventName];
      
      // Sort: PAID -> NOT PAID -> AMOUNT MISMATCH
      data.sort((a, b) => {
        const order: Record<string, number> = { 'PAID': 1, 'NOT PAID': 2, 'AMOUNT MISMATCH': 3, 'REVIEW REQUIRED': 4 };
        return (order[a.status] || 99) - (order[b.status] || 99);
      });

      const sheetData = data.map(r => ({
        Name: r.name,
        Email: r.email,
        Phone: r.phone,
        USN: r.usn,
        College: r.college,
        Track: r.track || '',
        'Expected Fee': r.expected_fee,
        'Amount Paid': r.amount_paid,
        'Payment Status': r.status,
        'Match Type': r.match_confidence > 0 ? `${r.match_confidence}% via ${r.matched_by}` : 'No Match'
      }));

      const worksheet = XLSX.utils.json_to_sheet(sheetData);
      
      // Excel sheet names max 31 characters and no invalid chars
      const safeSheetName = eventName.replace(/[\\/?*[\]]/g, '').slice(0, 31);
      
      try {
        XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName || 'Event');
      } catch (e) {
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Event_' + Math.floor(Math.random() * 1000));
      }
    });

    XLSX.writeFile(workbook, 'reconciliation_report.xlsx');
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
