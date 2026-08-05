import { readFile } from 'node:fs/promises';
import { DevicePingsSchema, type DevicePings } from '@acme/types';

// Intentionally duplicated from apps/ping-ingest: this app was added under the
// constraint that nothing inside packages/ may change, so the shared CLI
// plumbing stays app-local. Lift it into an @acme/pings-io package the moment
// that constraint goes away — see docs/PING-PIPELINE.md.

/** Print to stderr and exit non-zero — CLI failures should never look like success. */
export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read a pings file named on the command line and validate it against the
 * schema. Every failure mode (no argument, unreadable file, malformed JSON,
 * schema violation) exits 1 with a message a human can act on.
 */
export async function loadPings(usage: string): Promise<DevicePings> {
  const filePath = process.argv[2];
  if (!filePath) {
    fail(usage);
  }

  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    fail(`cannot read ${filePath}: ${describe(error)}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    fail(`${filePath} is not valid JSON: ${describe(error)}`);
  }

  const result = DevicePingsSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `  ${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`,
    );
    fail([`${filePath} does not match DevicePingSchema:`, ...issues].join('\n'));
  }

  return result.data;
}
