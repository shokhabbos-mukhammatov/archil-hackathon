// Account check for the two leading ideas. Run it yourself, with your key set in your own terminal:
//
//   ARCHIL_API_KEY=<your key>  [ARCHIL_REGION=aws-us-east-1]  node archil-check.mjs
//
// It creates a few throwaway disks named "premise-check-...", runs about 40 serverless calls,
// and deletes only the disks it created. It never prints your key or any disk token.

import { Archil } from 'disk';

if (!process.env.ARCHIL_API_KEY) {
  console.error('ARCHIL_API_KEY is not set in this terminal. Set it, then run again.');
  process.exit(2);
}
// An Archil API key only works in the region it was created in. If ARCHIL_REGION is not set,
// find the right one with a read-only "list disks" call in each region.
const REGIONS = ['aws-us-east-1', 'aws-us-west-2', 'aws-eu-west-1', 'gcp-us-central1'];
let region = process.env.ARCHIL_REGION;
if (!region) {
  console.log('ARCHIL_REGION is not set; looking for the region this key belongs to...');
  for (const candidate of REGIONS) {
    try {
      await new Archil({ region: candidate }).disks.list({ limit: 1 });
      console.log(`  ${candidate}: key accepted`);
      region = candidate;
      break;
    } catch (e) {
      console.log(`  ${candidate}: rejected (status ${e?.status ?? '?'})`);
    }
  }
  if (!region) {
    console.error('\nThe key was rejected in every region. Check that it was copied in full and is an account API key (it starts with "key-"), not a disk token.');
    process.exit(1);
  }
  if (region.startsWith('gcp')) console.log('  Note: serverless calls are only available in AWS regions, so most steps below will fail here.');
}
const archil = new Archil({ region });
const tag = Math.random().toString(36).slice(2, 8);
const created = [];
const results = [];

const fmtErr = (e) => `${e?.name ?? 'Error'} status=${e?.status ?? '?'} code=${e?.code ?? '?'} :: ${String(e?.message ?? e).replace(/\s+/g, ' ').slice(0, 260)}`;
const clip = (s, n = 500) => String(s ?? '').trim().slice(0, n);
const record = (name, verdict, detail) => { results.push({ name, verdict }); console.log(`\n[${verdict}] ${name}\n${detail}`); };

async function newDisk(label) {
  const t0 = Date.now();
  const { disk } = await archil.disks.create({ name: `premise-check-${tag}-${label}` });
  created.push(disk);
  return { disk, ms: Date.now() - t0 };
}
const show = (r) => `exit=${r.exitCode} queueMs=${r.timing?.queueMs ?? '?'} totalMs=${r.timing?.totalMs ?? '?'}\nstdout: ${clip(r.stdout)}\nstderr: ${clip(r.stderr, 300)}`;

async function step(name, fn) {
  try { await fn(); } catch (e) { record(name, 'ERROR', fmtErr(e)); }
}

console.log(`Archil account check, region ${region}, run tag ${tag}`);
let main;

await step('1. Create a disk and run one command', async () => {
  const { disk, ms } = await newDisk('main');
  main = disk;
  const t0 = Date.now();
  const r = await disk.exec('echo ok && pwd && id -u && (command -v strace || echo no-strace) && (command -v curl || echo no-curl)');
  record('1. Create a disk and run one command', r.exitCode === 0 ? 'PASS' : 'FAIL', `disk created in ${ms} ms; first call took ${Date.now() - t0} ms from this laptop\n${show(r)}`);
});
if (!main) { console.log('\nCannot continue without a disk.'); process.exit(1); }

await step('2. Nothing but the disk survives between calls', async () => {
  await main.exec('cd /tmp && export FOO=bar && echo hello > /tmp/scratch.txt && echo first-call-done');
  const r = await main.exec('pwd; echo "FOO=${FOO:-unset}"; cat /tmp/scratch.txt 2>&1');
  const stateless = /FOO=unset/.test(r.stdout) && !/hello/.test(r.stdout);
  record('2. Nothing but the disk survives between calls', stateless ? 'PASS' : 'INFO', `expected: working directory reset, FOO unset, /tmp file gone\n${show(r)}`);
});

await step('3. A call can write to scratch space outside the disk', async () => {
  const r = await main.exec('echo hi > /tmp/x && cat /tmp/x && mkdir -p /opt/t && echo rootfs-writable && df -h /tmp | tail -1');
  record('3. A call can write to scratch space outside the disk', /hi/.test(r.stdout) ? 'PASS' : 'FAIL', show(r));
});

await step('4. Seed files through the object API from this laptop', async () => {
  await main.putObject('work/src/app.txt', 'application code\n');
  await main.putObject('secrets/key.txt', `CANARY-${tag}\n`);
  const r = await main.exec('ls -R . | head -20 && cat secrets/key.txt');
  record('4. Seed files through the object API from this laptop', r.stdout.includes(`CANARY-${tag}`) ? 'PASS' : 'FAIL', show(r));
});

await step('5. A folder-only, read-only mount hides the rest of the disk', async () => {
  const r = await archil.exec({
    disks: { work: { disk: main, subdirectory: 'work', readOnly: true } },
    command: [
      'echo "--- visible:"; ls -la /mnt/archil /mnt/archil/work',
      'echo "--- try parent:"; ls /mnt/archil/work/.. ; cat /mnt/archil/work/../secrets/key.txt 2>&1',
      'echo "--- search whole machine for the secret file:"; find / -name key.txt -not -path "/proc/*" -not -path "/sys/*" 2>/dev/null | head -5; echo "(end of search)"',
      `echo "--- grep whole machine for the canary:"; grep -rl "CANARY-${tag}" /mnt /tmp /root /home 2>/dev/null | head -5; echo "(end of grep)"`,
      'echo "--- try write:"; touch /mnt/archil/work/new.txt 2>&1; echo "write_exit=$?"',
    ].join('; '),
  });
  const leaked = r.stdout.includes(`CANARY-${tag}`) || /secrets\/key\.txt/.test(r.stdout.split('--- try write')[0].split('--- search')[1] ?? '');
  const writeBlocked = /write_exit=[1-9]/.test(r.stdout);
  record('5. A folder-only, read-only mount hides the rest of the disk', !leaked && writeBlocked ? 'PASS' : 'FAIL', `secret reachable: ${leaked ? 'YES' : 'no'}; write blocked: ${writeBlocked ? 'yes' : 'NO'}\n${show({ ...r, stdout: clip(r.stdout, 1400) })}`);
});

await step('6. Two folders of the same disk mounted separately in one call', async () => {
  const r = await archil.exec({
    disks: { code: { disk: main, subdirectory: 'work' }, keys: { disk: main, subdirectory: 'secrets', readOnly: true } },
    command: 'ls /mnt/archil/code /mnt/archil/keys && touch /mnt/archil/keys/x 2>&1; echo "keys_write_exit=$?"',
  });
  record('6. Two folders of the same disk mounted separately in one call', r.exitCode === 0 || /keys_write_exit/.test(r.stdout) ? 'PASS' : 'FAIL', show(r));
});

const netProbe = 'curl -sS -m 8 -o /dev/null -w "http=%{http_code}" https://example.com 2>&1; echo; (getent hosts example.com || nslookup example.com 2>&1 | tail -2 || echo no-dns-tool); echo "probe-done"';

await step('7a. Control: the same network probe with no policy', async () => {
  const r = await main.exec(netProbe);
  record('7a. Control: the same network probe with no policy', /http=200/.test(r.stdout) ? 'PASS' : 'INFO', show(r));
});

await step('7b. Per-call network deny is accepted on this account', async () => {
  try {
    const r = await main.exec(netProbe, { network: { egress: { default: 'deny' } } });
    const blocked = !/http=200/.test(r.stdout);
    // A resolved name shows up as "<IPv4 or IPv6 address> example.com" (getent) or "Address: ..." (nslookup).
    const nameResolved = /^[0-9a-f:.]+\s+example\.com/im.test(r.stdout) || /Address: [0-9a-f:.]+/i.test(r.stdout);
    record('7b. Per-call network deny is accepted on this account', blocked ? 'PASS' : 'FAIL', `request blocked: ${blocked ? 'yes' : 'NO'}; name lookup still answered: ${nameResolved ? 'YES' : 'no'}\n${show(r)}`);
  } catch (e) {
    const planGated = e?.status === 403 || /network_plan_required/.test(String(e?.message));
    record('7b. Per-call network deny is accepted on this account', planGated ? 'BLOCKED BY PLAN' : 'ERROR', fmtErr(e));
  }
});

await step('7c. Network deny with one allowed host', async () => {
  try {
    const r = await main.exec('curl -sS -m 8 -o /dev/null -w "allowed=%{http_code}" https://example.com 2>&1; echo; curl -sS -m 8 -o /dev/null -w "other=%{http_code}" https://www.wikipedia.org 2>&1; echo', { network: { egress: { default: 'deny', allow: ['example.com'] } } });
    record('7c. Network deny with one allowed host', /allowed=200/.test(r.stdout) && !/other=200/.test(r.stdout) ? 'PASS' : 'INFO', show(r));
  } catch (e) {
    record('7c. Network deny with one allowed host', e?.status === 403 ? 'BLOCKED BY PLAN' : 'ERROR', fmtErr(e));
  }
});

await step('8. More than five disks can exist at once', async () => {
  let made = 0, failure = null;
  for (let i = 0; i < 7; i++) {
    try { await newDisk(`q${i}`); made++; } catch (e) { failure = fmtErr(e); break; }
  }
  record('8. More than five disks can exist at once', failure ? 'LIMIT HIT' : 'PASS', failure ? `created ${made} extra disk(s) (plus the main one) before: ${failure}` : `created ${made} extra disks plus the main one (${made + 1} in this run) with no error`);
});

await step('9. Twenty calls at once', async () => {
  const t0 = Date.now();
  const settled = await Promise.allSettled(Array.from({ length: 20 }, () => main.exec('true')));
  const ok = settled.filter((s) => s.status === 'fulfilled' && s.value.exitCode === 0);
  const queue = ok.map((s) => s.value.timing?.queueMs).filter((n) => typeof n === 'number').sort((a, b) => a - b);
  const firstErr = settled.find((s) => s.status === 'rejected');
  record('9. Twenty calls at once', ok.length === 20 ? 'PASS' : 'INFO', `${ok.length}/20 succeeded in ${Date.now() - t0} ms wall time; queueMs median ${queue[Math.floor(queue.length / 2)] ?? '?'}, max ${queue.at(-1) ?? '?'}${firstErr ? `\nfirst error: ${fmtErr(firstErr.reason)}` : ''}`);
});

console.log('\n--- cleanup: deleting only the disks this run created ---');
for (const d of created) {
  try { await d.delete(); console.log(`deleted ${d.name}`); } catch (e) { console.log(`could NOT delete ${d.name} (${d.id}): ${fmtErr(e)}`); }
}

console.log('\n=== summary ===');
for (const r of results) console.log(`${r.verdict.padEnd(16)} ${r.name}`);
