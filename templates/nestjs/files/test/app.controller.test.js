const test = require('node:test');
const assert = require('node:assert/strict');
const { AppController } = require('../dist/app.controller');

test('health reports ok', () => {
  assert.deepEqual(new AppController().health(), { status: 'ok' });
});
