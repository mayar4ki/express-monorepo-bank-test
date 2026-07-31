import http from 'node:http';

import type { TelemetryDb } from '@bank/db-telemetry';
import { sql } from 'drizzle-orm';

/**
 * Minimal health endpoint so orchestrators (compose healthcheck, k8s probes)
 * can watch the consumers. 200 means the database is reachable and every
 * consumer this process is responsible for is still running — a crashed
 * consumer would otherwise silently stop writing while the process looks fine.
 */
export function startHealthServer(opts: {
  port: number;
  db: TelemetryDb;
  isRunning: () => boolean;
  consumersRunning: () => Record<string, boolean>;
}): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }

    void opts.db
      .execute(sql`select 1`)
      .then(() => {
        const consumers = opts.consumersRunning();
        const healthy = opts.isRunning() && Object.values(consumers).every(Boolean);
        res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: healthy ? 'ok' : 'degraded', consumers }));
      })
      .catch(() => {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'database-unreachable' }));
      });
  });

  server.listen(opts.port);
  return server;
}
