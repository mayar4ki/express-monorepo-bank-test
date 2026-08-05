import { formatDeviceMaxSpeeds } from '@acme/pings';
import { fail, loadPings } from './load-pings.js';

const USAGE = 'usage: ping-report <path-to-pings.json>';

async function main(): Promise<void> {
  const pings = await loadPings(USAGE);

  // No formatting here by design: the unit, the precision and the alignment all
  // live in @acme/pings, so every consumer renders a speed identically.
  const lines = formatDeviceMaxSpeeds(pings);

  if (lines.length === 0) {
    console.log('no pings');
    return;
  }

  for (const line of lines) {
    console.log(line);
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
