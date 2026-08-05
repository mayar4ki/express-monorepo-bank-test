import { summarizePings } from '@acme/pings';
import { fail, loadPings } from './load-pings.js';

const USAGE = 'usage: ping-ingest <path-to-pings.json>';

async function main(): Promise<void> {
  const pings = await loadPings(USAGE);
  const { count, maxSpeed } = summarizePings(pings);

  console.log(`count=${count} maxSpeed=${maxSpeed}`);
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
