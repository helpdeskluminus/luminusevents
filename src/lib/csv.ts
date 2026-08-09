/** Minimal CSV parser: handles quoted fields (with embedded commas/newlines) and escaped quotes ("" inside a quoted field). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') {
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);

  return rows;
}

export interface CsvParticipantRow {
  name: string;
  email: string;
  phone: string;
  organization: string;
}

const HEADER_ALIASES: Record<string, keyof CsvParticipantRow> = {
  name: 'name', 'full name': 'name', fullname: 'name',
  email: 'email', 'email address': 'email',
  phone: 'phone', 'phone number': 'phone', mobile: 'phone',
  organization: 'organization', organisation: 'organization', college: 'organization', 'college/organisation': 'organization',
};

/** Parses a roster CSV with a header row into participant rows, matching common header spellings. */
export function parseParticipantCsv(text: string): { rows: CsvParticipantRow[]; error?: string } {
  const raw = parseCsv(text);
  if (raw.length === 0) return { rows: [], error: 'The file is empty' };

  const header = raw[0].map((h) => h.trim().toLowerCase());
  const nameIdx = header.findIndex((h) => HEADER_ALIASES[h] === 'name');
  const emailIdx = header.findIndex((h) => HEADER_ALIASES[h] === 'email');
  const phoneIdx = header.findIndex((h) => HEADER_ALIASES[h] === 'phone');
  const orgIdx = header.findIndex((h) => HEADER_ALIASES[h] === 'organization');

  if (nameIdx === -1 || emailIdx === -1) {
    return { rows: [], error: 'CSV needs at least "name" and "email" columns' };
  }

  const rows = raw.slice(1).map((r) => ({
    name: (r[nameIdx] ?? '').trim(),
    email: (r[emailIdx] ?? '').trim(),
    phone: phoneIdx >= 0 ? (r[phoneIdx] ?? '').trim() : '',
    organization: orgIdx >= 0 ? (r[orgIdx] ?? '').trim() : '',
  })).filter((r) => r.name || r.email);

  return { rows };
}
