// One-shot importer: attendee CSV -> SQLite allowlist.
//
//   EDGECLOUD_DATA=./server-data EDGECLOUD_SHARED_SALT=... \
//     npm run import-allowlist -- "/path/to/attendees.csv"
//
// Only the Email column is used; everything else in the CSV is ignored and
// never stored. Handles quoted CSV fields (names contain commas).

import fs from 'node:fs';
import { openDb, makeQueries } from './db.js';
import { config } from './config.js';

export function parseCsv(text) {
  // Minimal RFC-4180 parser: quotes, escaped quotes, commas/newlines in quotes.
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

export function extractEmails(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const emailIdx = header.indexOf('email');
  if (emailIdx === -1) throw new Error(`CSV has no "Email" column (header: ${rows[0].join(', ')})`);
  const emails = [];
  for (const r of rows.slice(1)) {
    const e = (r[emailIdx] || '').trim().toLowerCase();
    if (e && e.includes('@')) emails.push(e);
  }
  return emails;
}

export function importAllowlist(csvPath, q) {
  const emails = extractEmails(fs.readFileSync(csvPath, 'utf8'));
  let added = 0;
  for (const e of emails) if (q.importAllowlistEmail(e)) added++;
  return { parsed: emails.length, added, total: q.allowlistCount() };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('usage: npm run import-allowlist -- <attendees.csv>');
    process.exit(1);
  }
  const db = openDb(config.dataDir);
  const q = makeQueries(db, config.sharedSalt);
  const r = importAllowlist(csvPath, q);
  console.log(`[allowlist] parsed ${r.parsed} emails, added ${r.added}, total now ${r.total}`);
  db.close();
}
