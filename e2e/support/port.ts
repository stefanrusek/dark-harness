// `--server`/`--connect --port` both require a positive integer (src/cli.ts's `parseArgs`
// rejects 0), so unlike the in-process client-side servers (local web UI, local TUI's own
// DhServer) which happily bind ephemeral port 0, tests that drive `--server` as a real OS
// process need a concrete free port picked up front to avoid collisions between e2e test
// files running concurrently.

export async function findFreePort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = server.port as number;
  server.stop(true);
  return port;
}
