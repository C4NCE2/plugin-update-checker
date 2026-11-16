import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  needsRefresh, recentFailure, readJsonSafe, TTL_MS,
  comparePlugin, shortVer, buildOutput,
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

test('comparePlugin: 条目缺失 → skip', () => {
  const r = comparePlugin({ version: '1.0.0', gitCommitSha: 'abc' }, null);
  assert.equal(r.status, 'skip');
  assert.equal(r.reason, 'entry-missing');
});

test('comparePlugin: 形态a url源 sha 相同 → current', () => {
  const inst = { version: '5.1.0', gitCommitSha: 'f2cbfbefebbfef77321e4c9abc9e949826bea9d7' };
  const entry = { name: 'superpowers', source: { source: 'url', url: 'https://x/y.git', sha: 'f2cbfbefebbfef77321e4c9abc9e949826bea9d7' } };
  assert.equal(comparePlugin(inst, entry).status, 'current');
});

test('comparePlugin: 形态a url源 sha 不同 → update,to 为 12 位短 sha', () => {
  const inst = { version: '5.1.0', gitCommitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
  const entry = { name: 'x', source: { source: 'url', sha: 'f2cbfbefebbfef77321e4c9abc9e949826bea9d7' } };
  const r = comparePlugin(inst, entry);
  assert.equal(r.status, 'update');
  assert.equal(r.to, 'f2cbfbefebbf');
  assert.equal(r.from, '5.1.0');
});

test('comparePlugin: 形态b version 相同 → current;不同 → update', () => {
  const entry = { name: 'swift-lsp', version: '1.0.0', source: './plugins/swift-lsp' };
  assert.equal(comparePlugin({ version: '1.0.0' }, entry).status, 'current');
  const r = comparePlugin({ version: '0.9.0' }, entry);
  assert.equal(r.status, 'update');
  assert.equal(r.to, '1.0.0');
});

test('comparePlugin: 已装 version 是 sha 回退值、条目是 semver → update(多提醒一次,更新后自愈)', () => {
  const entry = { name: 'p', version: '2.0.0', source: './plugins/p' };
  const inst = { version: '8435428dfc0f', gitCommitSha: '8435428dfc0fd6e4fea1c8e505ef5022b1f0d403' };
  assert.equal(comparePlugin(inst, entry).status, 'update');
});

test('comparePlugin: 形态c 仓库内置且无 version → repo-check 携带 subPath', () => {
  const inst = { version: 'da20c92503b2', gitCommitSha: 'da20c92503b2e8ff1cf28ca81a0df4673debdbf7' };
  const entry = { name: 'document-skills', source: './skills/document-skills' };
  const r = comparePlugin(inst, entry);
  assert.equal(r.status, 'repo-check');
  assert.equal(r.subPath, './skills/document-skills');
});

test('comparePlugin: url 源但无 sha → skip', () => {
  const r = comparePlugin({ gitCommitSha: 'a' }, { name: 'x', source: { source: 'url', url: 'u' } });
  assert.equal(r.status, 'skip');
  assert.equal(r.reason, 'url-no-sha');
});

test('comparePlugin: entry.source 缺失/null → skip reason undecidable', () => {
  assert.equal(comparePlugin({ version: '1.0' }, { name: 'x' }).reason, 'undecidable');
  assert.equal(comparePlugin({ version: '1.0' }, { name: 'x', source: null }).reason, 'undecidable');
});

test('comparePlugin: 条目 sha 为空串 → skip(不误报 update)', () => {
  const r = comparePlugin(
    { version: '5.1.0', gitCommitSha: 'f2cbfbefebbfef77321e4c9abc9e949826bea9d7' },
    { name: 'x', source: { source: 'url', sha: '' } },
  );
  assert.equal(r.status, 'skip');
  assert.equal(r.reason, 'url-no-sha');
});

test('shortVer: semver 原样;长 sha 截 12 位;12 位 sha 原样;非字符串 → ?', () => {
  assert.equal(shortVer('5.1.0'), '5.1.0');
  assert.equal(shortVer('f2cbfbefebbfef77321e4c9abc9e949826bea9d7'), 'f2cbfbefebbf');
  assert.equal(shortVer('da20c92503b2'), 'da20c92503b2');
  assert.equal(shortVer(undefined), '?');
});

test('buildOutput: 空数组 → null', () => {
  assert.equal(buildOutput([]), null);
});

test('buildOutput: systemMessage/additionalContext 结构与文案', () => {
  const out = buildOutput(
    [
      { plugin: 'superpowers@claude-plugins-official', from: '5.1.0', to: 'f2cbfbefebbf' },
      { plugin: 'andrej-karpathy-skills@karpathy-skills', from: '1.0.0', to: '1.1.0' },
    ],
    [['karpathy-skills', 3]],
  );
  assert.match(out.systemMessage, /2 个 Claude Code 插件有更新/);
  assert.match(out.systemMessage, /superpowers 5\.1\.0 → f2cbfbefebbf \(claude-plugins-official\)/);
  assert.match(out.systemMessage, /claude plugin update superpowers@claude-plugins-official/);
  assert.match(out.systemMessage, /claude plugin update andrej-karpathy-skills@karpathy-skills/);
  assert.match(out.systemMessage, /\/reload-plugins/);
  assert.match(out.systemMessage, /karpathy-skills 版本信息已过期 3 天/);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /superpowers@claude-plugins-official/);
  assert.match(out.hookSpecificOutput.additionalContext, /claude plugin update/);
});
