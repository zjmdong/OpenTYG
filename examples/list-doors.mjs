// Read-only directory example. No SMS requests, door commands, or intercom calls.
// Supply credentials through a trusted launcher or secret store, never source code.
import { TygClient, TygError } from '../src/tyg-client.mjs';
const account = process.env.TYG_ACCOUNT;
const password = process.env.TYG_PASSWORD;
if (!account || !password) {
  console.error('Provide TYG_ACCOUNT and TYG_PASSWORD through your trusted environment.');
  process.exit(1);
}
const sdk = new TygClient({ lastLoginOs: '4' });
try {
  await sdk.initialize();
  await sdk.loginPassword(account, password);
  const household = (await sdk.getHouseholds()).find(item => item.available);
  if (!household) throw new Error('NO_AUTHORIZED_PROPERTY');
  const directory = await sdk.getDoors(household.id);
  // Property addresses and device identifiers are intentionally not printed.
  console.log(`Authorized door count: ${directory.doors.length}`);
} catch (error) {
  // Do not print upstream error text, full responses, tokens, or credential URLs.
  console.error(error instanceof TygError ? error.code : 'DIRECTORY_QUERY_FAILED');
  process.exitCode = 1;
} finally {
  sdk.close();
}
