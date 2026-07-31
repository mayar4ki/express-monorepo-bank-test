import http from 'node:http';

/**
 * Minimal health endpoint so orchestrators (compose healthcheck, k8s probes)
 * can watch the listener. 200 means we are accepting devices and can still
 * reach Kafka; anything else means a device connecting now would be told its
 * data is safe when it is not, so it is better to be taken out of rotation.
 */
export function startHealthServer(opts: {
  port: number;
  checks: Record<string, () => boolean>;
}): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }

    const results = Object.fromEntries(
      Object.entries(opts.checks).map(([name, check]) => [name, check()]),
    );
    const healthy = Object.values(results).every(Boolean);

    res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: healthy ? 'ok' : 'degraded', checks: results }));
  });

  server.listen(opts.port);
  return server;
}
