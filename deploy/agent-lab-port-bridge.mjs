import net from 'node:net';

function boundedPort(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1024 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1024 and 65535`);
  }
  return value;
}

const start = boundedPort('INITPAD_AGENT_LAB_PORT_START', 42_000);
const end = boundedPort('INITPAD_AGENT_LAB_PORT_END', 42_031);
if (end < start || end - start > 127) {
  throw new Error('Agent lab port range must contain between 1 and 128 ports');
}

const targetHost = process.env.INITPAD_AGENT_LAB_TARGET_HOST ?? 'agent-lab-docker';
if (!/^[a-zA-Z0-9.-]+$/.test(targetHost)) {
  throw new Error('INITPAD_AGENT_LAB_TARGET_HOST is invalid');
}

const servers = [];
for (let port = start; port <= end; port += 1) {
  const server = net.createServer((downstream) => {
    const upstream = net.connect({ host: targetHost, port });
    downstream.setNoDelay(true);
    upstream.setNoDelay(true);
    downstream.on('error', () => upstream.destroy());
    upstream.on('error', () => downstream.destroy());
    downstream.pipe(upstream);
    upstream.pipe(downstream);
  });
  server.on('error', (error) => {
    console.error(JSON.stringify({ event: 'agent_lab_bridge.error', port, message: error.message }));
  });
  await new Promise((resolve, reject) => {
    const failed = (error) => reject(error);
    server.once('error', failed);
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', failed);
      resolve();
    });
  });
  servers.push(server);
}

console.log(JSON.stringify({
  event: 'agent_lab_bridge.ready',
  targetHost,
  ports: `${start}-${end}`,
}));

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  process.exit(0);
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
