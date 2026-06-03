import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, extractEmails } from '../src/allowlist-import.js';

test('parseCsv handles quoted fields with commas', () => {
  const rows = parseCsv('First,Last,Email,Residence\nAda,Lovelace,ada@x.com,"London, UK"\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], ['Ada', 'Lovelace', 'ada@x.com', 'London, UK']);
});

test('extractEmails reads the Email column, lowercased, skips blanks', () => {
  const csv =
    'First Name,Last Name,Email,Telegram\n' +
    ',,MCSUAR@gmail.com,\n' +
    'Wiktoria,Pawlak,W.A.Pawlak@berkeley.edu,wikip00\n' +
    ',,,\n' +
    'No,Email,notanemail,\n';
  const emails = extractEmails(csv);
  assert.deepEqual(emails, ['mcsuar@gmail.com', 'w.a.pawlak@berkeley.edu']);
});

test('extractEmails throws without an Email column', () => {
  assert.throws(() => extractEmails('Name,Phone\nAda,555\n'), /no "Email" column/);
});
