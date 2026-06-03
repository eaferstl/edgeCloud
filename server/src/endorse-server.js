// CLI: endorse a new central server into the trust chain.
//
//   npm run endorse-server -- <serverPubkeyB64> [multiaddrsCommaSeparated] [label]
//
// Talks to the locally running server's admin endpoint (localhost-only) so the
// running process appends the endorsement to the edgecloud-servers DB and it
// replicates to the whole network. The local server signs with its own key;
// it must itself be trusted (genesis or previously endorsed).

const [pubkey, multiaddrsArg = '', label = ''] = process.argv.slice(2);
if (!pubkey) {
  console.error('usage: npm run endorse-server -- <serverPubkeyB64> [multiaddrs,comma,separated] [label]');
  process.exit(1);
}

const port = process.env.HTTP_PORT || '8080';
const res = await fetch(`http://127.0.0.1:${port}/api/admin/endorse`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    serverPubkey: pubkey,
    multiaddrs: multiaddrsArg.split(',').map((s) => s.trim()).filter(Boolean),
    label,
  }),
});
const body = await res.json();
if (!res.ok) {
  console.error(`endorsement failed (${res.status}):`, body.error || body);
  process.exit(1);
}
console.log('endorsed:', JSON.stringify(body.entry, null, 2));
