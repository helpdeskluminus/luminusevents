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
  id: string;
  team_id: string;
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
  fraud_flag: string;
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

  const normalizeKey = (k: string) => k.toLowerCase().replace(/\s+/g, '').replace(/[^a-z]/g, '');
  const buildRowMapper = (row: any) => {
    const map: Record<string, any> = {};
    Object.keys(row).forEach(k => { map[normalizeKey(k)] = row[k]; });
    return map;
  };

  const getValue = (map: any, possibleKeys: string[]) => {
    for (const key of possibleKeys) {
      const val = map[normalizeKey(key)];
      if (val !== undefined && val !== "") return val;
    }
    return null;
  };

  const cleanEmail = (val: any) => String(val || '').toLowerCase().trim();
  const cleanPhone = (val: any) => String(val || '').replace(/\D/g, '').slice(-10);
  const cleanText = (val: any) => String(val || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const normalizeEvent = (val: any) => {
    return cleanText(
      String(val || '').replace(/- rs.*$/i, '').replace(/\(.*?\)/g, '').replace(/luminus.*$/i, '')
    );
  };

  const levenshtein = (a: string, b: string) => {
    const matrix = Array.from({ length: b.length + 1 }, () => [] as number[]);
    for (let i = 0; i <= b.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b[i - 1] === a[j - 1]) matrix[i][j] = matrix[i - 1][j - 1];
        else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[b.length][a.length];
  };

  const nameSimilarity = (a: string, b: string) => {
    if (!a || !b) return 0;
    const dist = levenshtein(a, b);
    return 1 - dist / Math.max(a.length, b.length);
  };

  const getMatchScore = (bill: any, participant: any, event_name: string) => {
    let score = 0;

    const pEmail = cleanEmail(participant.email);
    const pPhone = cleanPhone(participant.phoneNumber || participant.phone);
    const pName = cleanText(participant.name);
    const pEvent = normalizeEvent(event_name);

    if (bill.email && pEmail === bill.email) score += 60;
    if (bill.phone && pPhone === bill.phone) score += 50;

    const similarity = nameSimilarity(pName, bill.name);
    if (similarity > 0.8) score += 25;
    else if (similarity > 0.6) score += 15;

    if (bill.event && (pEvent.includes(bill.event) || bill.event.includes(pEvent))) {
      score += 30;
    }

    return score;
  };

  const EVENT_CODE_MAP: Record<string, string> = {
    "reverseimageprompting": "SXDT",
    "turingtest": "SXAI",
    "solarsisx": "SXMAIN"
  };

  const generatePrefix = (event: string, track: string) => {
    const key = normalizeEvent(event);
    if (EVENT_CODE_MAP[key]) return EVENT_CODE_MAP[key];
    const e = (event || '').toUpperCase().split(' ').map(w => w[0]).join('').slice(0, 2);
    const t = (track || '').toUpperCase().split(' ').map(w => w[0]).join('').slice(0, 2);
    return (e + t).padEnd(4, 'X');
  };

  const readExcel = async (file: File): Promise<any[]> => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
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
      const bdRows = bdData.map(raw => {
        const row = buildRowMapper(raw);
        const email = cleanEmail(getValue(row, ["emailid", "email"]));
        const phone = cleanPhone(getValue(row, ["mobileno", "phone"]));
        const name = cleanText(getValue(row, ["teamleadername", "name"]));
        const amount = parseFloat(String(getValue(row, ["paidamount", "transactionamount", "amount"]) || "0").replace(/[^\d.-]/g, "")) || 0;
        const event = normalizeEvent(getValue(row, ["eventname", "event"]));
        const status = cleanText(getValue(row, ["status", "transactionstatus"]));
        return {
          email, phone, name, amount, event,
          valid: status === "success" || status === ""
        };
      }).filter(r => r.valid);

      // 2. Parse Supabase
      const sbData = await readExcel(supabaseFile);
      const sbRows: ParsedSupabaseRow[] = sbData.map(row => {
        let participants = [];
        try {
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
        return { participants, expected_fee, team_id: row.event_name || row.Event || '' };
      });

      // 3. MATCHING ENGINE
      const flattened: FinalParticipant[] = [];
      let totReg = 0, totPay = 0, pendPay = 0, rev = 0;
      const evRev: Record<string, number> = {};
      const counters: Record<string, number> = {};
      const usedPayments = new Set<string>();

      const getId = (eventName: string, track: string) => {
        const prefix = generatePrefix(eventName, track);
        if (!counters[prefix]) counters[prefix] = 1;
        const id = `${prefix}${String(counters[prefix]).padStart(3, '0')}`;
        counters[prefix]++;
        return id;
      };

      sbRows.forEach(teamRow => {
        if (!teamRow.participants?.length) return;

        const team = teamRow.participants;
        const first = team[0];
        const event_name = String(teamRow.team_id || '').trim();
        const expected = Number(teamRow.expected_fee);

        // 🔥 FIND BEST MATCH
        const scored = bdRows.map(b => ({
          ...b,
          score: getMatchScore(b, first, event_name)
        }));

        const best = scored.sort((a, b) => b.score - a.score)[0];

        let status = "NOT PAID";
        let paid = 0;
        let confidence = 0;
        let fraud = "CLEAN";

        if (best && best.score >= 40) {
          const key = `${best.email}-${best.phone}-${best.amount}`;
          if (usedPayments.has(key)) {
            fraud = "DUPLICATE PAYMENT";
            status = "REVIEW REQUIRED";
          } else {
            usedPayments.add(key);
            paid = best.amount;
            confidence = best.score;

            if (paid === expected) status = "PAID";
            else status = "AMOUNT MISMATCH";
          }
        }

        const teamId = getId(event_name, first.track || first.track_name || '');

        team.forEach((p, index) => {
          const participantId = `${teamId}-${index + 1}`;
          
          flattened.push({
            id: participantId,
            team_id: teamId,
            name: p.name || '',
            email: p.email || '',
            phone: p.phoneNumber || p.phone || '',
            usn: p.studentId || p.usn || '',
            college: p.collegeName || p.college || '',
            event: event_name,
            track: p.track || p.track_name || '',
            amount_paid: paid,
            expected_fee: expected,
            status: status,
            match_confidence: confidence,
            fraud_flag: fraud,
            matched_by: confidence ? `AI Engine (${confidence})` : 'No Match'
          });

          totReg++;
        });

        if (status === 'PAID') {
          totPay++;
          rev += paid;
          evRev[event_name] = (evRev[event_name] || 0) + paid;
        } else if (status === 'REVIEW REQUIRED' || status === 'AMOUNT MISMATCH') {
          pendPay++; // Tracked separately or pending
        } else {
          pendPay++;
        }
      });

      setResults(flattened);
      setStats({ totalRegistrations: totReg, totalPayments: totPay, pendingPayments: pendPay, revenue: rev, eventRevenue: evRev });

      toast({ title: 'Processing Complete', description: `Processed ${flattened.length} participants.` });
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
      
      // Sort: PAID -> REVIEW REQUIRED -> NOT PAID -> DUPLICATE PAYMENT
      data.sort((a, b) => {
        const order: Record<string, number> = { 
           'PAID': 1, 
           'REVIEW REQUIRED': 2, 
           'AMOUNT MISMATCH': 3, 
           'NOT PAID': 4, 
           'DUPLICATE PAYMENT': 5 
        };
        return (order[a.status] || 99) - (order[b.status] || 99);
      });

      const sheetData = data.map(r => ({
        'Team Member ID': r.id,
        'Team ID': r.team_id,
        Name: r.name,
        Email: r.email,
        Phone: r.phone,
        USN: r.usn,
        College: r.college,
        Track: r.track || '',
        'Expected Fee': r.expected_fee,
        'Amount Paid': r.amount_paid,
        'Payment Status': r.status,
        'Match Confidence': r.match_confidence > 0 ? `${r.match_confidence}%` : '0%',
        'Fraud Flag': r.fraud_flag
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
        const ev = events?.find(e => cleanText(e.name).includes(cleanText(r.event)) || cleanText(r.event).includes(cleanText(e.name)));
        const tr = tracks?.find(t => t.event_id === ev?.id && (cleanText(t.name).includes(cleanText(r.track)) || cleanText(r.track).includes(cleanText(t.name))));
        
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
    if (status === 'AMOUNT MISMATCH' || status === 'REVIEW REQUIRED') return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    if (status === 'DUPLICATE PAYMENT') return <AlertTriangle className="h-4 w-4 text-destructive" />;
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
                      <th className="px-4 py-3 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Member ID</th>
                      <th className="px-4 py-3 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Team ID</th>
                      <th className="px-4 py-3 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Name</th>
                      <th className="px-4 py-3 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Email</th>
                      <th className="px-4 py-3 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Phone</th>
                      <th className="px-4 py-3 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Event / Track</th>
                      <th className="px-4 py-3 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Fee / Paid</th>
                      <th className="px-4 py-3 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Status</th>
                      <th className="px-4 py-3 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">AI Score</th>
                      <th className="px-4 py-3 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">Fraud Flag</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-body">
                    {results.slice(0, 100).map((r, i) => (
                      <tr key={i} className={`hover:bg-secondary/30 transition-colors ${r.fraud_flag === 'FRAUD' || r.fraud_flag === 'DUPLICATE PAYMENT' ? 'bg-destructive/5' : ''}`}>
                        <td className="px-4 py-3 text-xs font-bold font-mono text-primary">{r.id}</td>
                        <td className="px-4 py-3 text-xs font-bold font-mono text-muted-foreground">{r.team_id}</td>
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
                            <span className={r.status === 'PAID' ? 'text-success' : r.status === 'NOT PAID' || r.status === 'DUPLICATE PAYMENT' ? 'text-destructive' : 'text-amber-500'}>
                              {r.status}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[10px] text-muted-foreground">
                          {r.match_confidence > 0 ? (
                            <span className={`px-2 py-0.5 rounded-full font-semibold ${r.match_confidence >= 80 ? 'bg-success/10 text-success' : 'bg-amber-500/10 text-amber-500'}`}>
                              {Math.round(r.match_confidence)}%
                            </span>
                          ) : 'No match'}
                        </td>
                        <td className="px-4 py-3 text-[10px] font-semibold">
                           <span className={r.fraud_flag === 'CLEAN' ? 'text-success' : r.fraud_flag === 'PROBABLE' ? 'text-amber-500' : 'text-destructive'}>
                             {r.fraud_flag}
                           </span>
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
