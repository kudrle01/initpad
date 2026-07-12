const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/index');

test('GET /health reports ok', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});
