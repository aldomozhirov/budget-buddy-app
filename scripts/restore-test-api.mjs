// API steps of scripts/restore-test.sh, so the shell script needs no JSON
// tools. Usage: node scripts/restore-test-api.mjs <seed|dump|status|export> <base URL>
import { stdout } from 'node:process';

const password = 'restore test family password';
const [, , command, base] = process.argv;
if (!command || !base) {
  console.error(
    'Usage: restore-test-api.mjs <seed|dump|status|export> <base URL>',
  );
  process.exit(2);
}
const origin = new URL(base).origin;

/** Keeps the cookies a server sets, as a browser would. */
const jar = new Map();
async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      origin,
      cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const [name, ...value] = pair.split('=');
    jar.set(name, value.join('='));
  }
  return response;
}
async function json(method, path, body, expected = 200) {
  const response = await call(method, path, body);
  if (response.status !== expected) {
    throw new Error(
      `${method} ${path} answered ${response.status}: ${await response.text()}`,
    );
  }
  return response.json();
}

async function signIn() {
  const result = await json('POST', '/api/auth/sign-in', { password });
  if (result.profileRequired) {
    const me = await json('GET', '/api/auth/me');
    const profile = me.members?.[0] ?? me.profiles?.[0];
    await json('POST', '/api/auth/profile', {
      memberId: profile.id,
      remember: false,
    });
  }
}

if (command === 'seed') {
  const setup = await json(
    'POST',
    '/api/setup',
    { password, passwordConfirmation: password, profiles: ['Alena', 'Max'] },
    201,
  );
  void setup;
  const accounts = [
    { name: 'Giro', type: 'bank', currency: 'EUR', openingBalance: '123456' },
    { name: 'Cash', type: 'cash', currency: 'USD', openingBalance: '9876' },
    {
      name: 'Savings',
      type: 'bank',
      currency: 'RUB',
      openingBalance: '150000000',
    },
  ];
  const ids = [];
  for (const account of accounts) {
    const created = await json('POST', '/api/accounts', account, 201);
    ids.push((created.account ?? created).id);
  }
  const started = await json('POST', '/api/checkins', {}, 201);
  const checkinId = (started.checkin ?? started).id;
  await json('PUT', `/api/checkins/${checkinId}/values/${ids[0]}`, {
    amount: '130000',
  });
  await json('PUT', `/api/checkins/${checkinId}/values/${ids[1]}`, {
    same: true,
  });
  await json('PUT', `/api/checkins/${checkinId}/values/${ids[2]}`, {
    amount: '-5',
  });
  // The last value leaves the check-in open; only a close call ends it.
  await json('POST', `/api/checkins/${checkinId}/close`, {}, 200);
  stdout.write(`seeded ${ids.length} accounts and check-in ${checkinId}\n`);
} else if (command === 'dump') {
  await signIn();
  const accounts = await json('GET', '/api/accounts?inactive=true');
  const checkins = await json('GET', '/api/checkins');
  // `stale` depends on the clock, not on the data, so it is left out.
  for (const account of accounts.accounts) delete account.stale;
  stdout.write(`${JSON.stringify({ accounts, checkins }, null, 2)}\n`);
} else if (command === 'status') {
  await signIn();
  stdout.write(`${JSON.stringify(await json('GET', '/api/backup/status'))}\n`);
} else if (command === 'export') {
  await signIn();
  const response = await call('GET', '/api/export');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const zip = response.status === 200 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  stdout.write(
    `${response.status} ${response.headers.get('content-type')} ${bytes.length} bytes\n`,
  );
  if (!zip) process.exit(1);
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(2);
}
