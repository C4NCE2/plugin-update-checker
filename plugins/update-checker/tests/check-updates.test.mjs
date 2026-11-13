import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  needsRefresh, recentFailure, readJsonSafe, TTL_MS,
} from '../scripts/check-updates.mjs';

const NOW = Date.parse('2026-11-13T12:00:00Z');

test('needsRefresh: 无状态/无记录 → true', () => {
  assert.equal(needsRefresh(null, 'm', NOW), true);
  assert.equal(needsRefresh({}, 'm', NOW), true);
});

test('needsRefresh: 刚刷新过 → false', () => {
  const state = { lastRefresh: { m: new Date(NOW - 1000).toISOString() } };
  assert.equal(needsRefresh(state, 'm', NOW), false);
});

test('needsRefresh: 恰好到达 TTL → true', () => {
  const state = { lastRefresh: { m: new Date(NOW - TTL_MS).toISOString() } };
  assert.equal(needsRefresh(state, 'm', NOW), true);
});

test('needsRefresh: 损坏的时间戳 → true', () => {
  assert.equal(needsRefresh({ lastRefresh: { m: 'not-a-date' } }, 'm', NOW), true);
});

test('recentFailure: 无记录 → false;30分钟前 → true;2小时前 → false', () => {
  assert.equal(recentFailure({}, 'm', NOW), false);
  const half = { lastFailure: { m: new Date(NOW - 30 * 60 * 1000).toISOString() } };
  assert.equal(recentFailure(half, 'm', NOW), true);
  const two = { lastFailure: { m: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() } };
  assert.equal(recentFailure(two, 'm', NOW), false);
});

test('readJsonSafe: 文件不存在 → null', () => {
  assert.equal(readJsonSafe('Z:/definitely/missing-update-checker.json'), null);
});

test('readJsonSafe: 损坏 JSON → null;有效 JSON → 对象', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uc-json-'));
  const broken = join(dir, 'broken.json');
  const valid = join(dir, 'valid.json');
  writeFileSync(broken, '{"broken":');
  writeFileSync(valid, '{"a":1}');
  assert.equal(readJsonSafe(broken), null);
  assert.deepEqual(readJsonSafe(valid), { a: 1 });
});

test('TTL_MS: 产品承诺锁定为 24h', () => {
  assert.equal(TTL_MS, 24 * 60 * 60 * 1000);
});

test('recentFailure: null state / 损坏时间戳 → false', () => {
  assert.equal(recentFailure(null, 'm', NOW), false);
  assert.equal(recentFailure({ lastFailure: { m: 'not-a-date' } }, 'm', NOW), false);
});
