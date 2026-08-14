import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type http from 'node:http';
import test from 'node:test';
import { writeRequestStream } from './docker-http.js';

class BackpressuredRequest extends EventEmitter {
  writes = 0;
  ended = false;

  write(): boolean {
    this.writes += 1;
    queueMicrotask(() => this.emit('drain'));
    return false;
  }

  end(): void {
    this.ended = true;
  }
}

test('streaming request body removes transient listeners after every drain', async () => {
  const request = new BackpressuredRequest();
  const chunks = Array.from({ length: 32 }, () => Buffer.alloc(1));

  await writeRequestStream(
    request as unknown as http.ClientRequest,
    (async function* () { yield* chunks; })(),
  );

  assert.equal(request.writes, chunks.length);
  assert.equal(request.ended, true);
  assert.equal(request.listenerCount('drain'), 0);
  assert.equal(request.listenerCount('error'), 0);
});

test('streaming request body removes listeners when a write fails', async () => {
  const request = new BackpressuredRequest();
  request.write = function write(): boolean {
    queueMicrotask(() => this.emit('error', new Error('socket failed')));
    return false;
  };

  await assert.rejects(
    writeRequestStream(
      request as unknown as http.ClientRequest,
      (async function* () { yield Buffer.alloc(1); })(),
    ),
    /socket failed/,
  );

  assert.equal(request.listenerCount('drain'), 0);
  assert.equal(request.listenerCount('error'), 0);
});
