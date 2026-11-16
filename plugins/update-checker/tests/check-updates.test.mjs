import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  needsRefresh, recentFailure, readJsonSafe, TTL_MS,
  comparePlugin, shortVer, splitKey, buildOutput, resolveLang,
  repoPluginChanged, refreshMarketplace,
  run, isCaughtUp, targetDate, installedVersion, loadIgnore,
} from '../scripts/check-updates.mjs';

const NOW = Date.parse('2026-11-13T12:00:00Z');

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'uc-test-'));
  git(dir, 'init');
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

function withConfigDir(cfg, fn) {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  const prevLang = process.env.UPDATE_CHECKER_LANG;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  process.env.UPDATE_CHECKER_LANG = 'zh';
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
    if (prevLang === undefined) delete process.env.UPDATE_CHECKER_LANG;
    else process.env.UPDATE_CHECKER_LANG = prevLang;
  }
}

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

test('shortVer: semver 原样;长 sha 截 12 位;12 位 sha 原样;非字符串/空串 → ?', () => {
  assert.equal(shortVer('5.1.0'), '5.1.0');
  assert.equal(shortVer('f2cbfbefebbfef77321e4c9abc9e949826bea9d7'), 'f2cbfbefebbf');
  assert.equal(shortVer('da20c92503b2'), 'da20c92503b2');
  assert.equal(shortVer(undefined), '?');
  assert.equal(shortVer(''), '?');
  assert.equal(shortVer('ab'.repeat(32)), 'abababababab');
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
    [['karpathy-skills', 3, false]],
    'zh',
  );
  assert.match(out.systemMessage, /2 个 Claude Code 插件有更新/);
  assert.match(out.systemMessage, /superpowers 5\.1\.0 → f2cbfbefebbf \(claude-plugins-official\)/);
  assert.match(out.systemMessage, /claude plugin update superpowers@claude-plugins-official/);
  assert.match(out.systemMessage, /claude plugin update andrej-karpathy-skills@karpathy-skills/);
  assert.match(out.systemMessage, /\/reload-plugins/);
  assert.match(out.systemMessage, /karpathy-skills 版本信息已过期 3 天/);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /请在本次回复的开头先向用户转达/);
  assert.match(out.hookSpecificOutput.additionalContext, /superpowers 5\.1\.0 → f2cbfbefebbf \(claude-plugins-official\)/);
  assert.match(out.hookSpecificOutput.additionalContext, /claude plugin update superpowers@claude-plugins-official/);
  assert.match(out.hookSpecificOutput.additionalContext, /用户要求更新时,逐条执行上述 claude plugin update 命令/);
});

test('splitKey: 常规 key 拆分;无 @ / @ 开头 → marketplace 为空串', () => {
  assert.deepEqual(splitKey('superpowers@claude-plugins-official'), ['superpowers', 'claude-plugins-official']);
  assert.deepEqual(splitKey('noat'), ['noat', '']);
  assert.deepEqual(splitKey('@x'), ['@x', '']);
});

test('repoPluginChanged: 子目录未动 → false;动过 → true;坏 sha/空 sha/非 hex sha → null', () => {
  const repo = makeRepo();
  mkdirSync(join(repo, 'plugins', 'foo'), { recursive: true });
  mkdirSync(join(repo, 'other'), { recursive: true });
  writeFileSync(join(repo, 'plugins', 'foo', 'a.txt'), '1');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'c1');
  const sha = git(repo, 'rev-parse', 'HEAD').trim();

  // 只改插件目录之外的文件 → 该插件无变化(用生产真实的 ./ 前缀 pathspec 形态)
  writeFileSync(join(repo, 'other', 'b.txt'), '2');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'c2');
  assert.equal(repoPluginChanged(repo, sha, './plugins/foo'), false);

  // 改插件目录内文件 → 有变化
  writeFileSync(join(repo, 'plugins', 'foo', 'a.txt'), '99');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'c3');
  assert.equal(repoPluginChanged(repo, sha, 'plugins/foo'), true);

  // sha 不在历史中 / 为空 / 非 hex(选项注入形态)→ 无法判定 null
  assert.equal(repoPluginChanged(repo, 'deadbeef'.repeat(5), 'plugins/foo'), null);
  assert.equal(repoPluginChanged(repo, '', 'plugins/foo'), null);
  assert.equal(repoPluginChanged(repo, '--output=x', 'plugins/foo'), null);
});

test('refreshMarketplace: 拉到 origin 新提交 → true;非 git 目录 → false', () => {
  const origin = makeRepo();
  writeFileSync(join(origin, 'f.txt'), '1');
  git(origin, 'add', '.');
  git(origin, 'commit', '-m', 'c1');

  const parent = mkdtempSync(join(tmpdir(), 'uc-parent-'));
  const clone = join(parent, 'clone');
  execFileSync('git', ['clone', origin, clone], { stdio: 'ignore' });

  writeFileSync(join(origin, 'f.txt'), '2');
  git(origin, 'add', '.');
  git(origin, 'commit', '-m', 'c2');

  assert.equal(refreshMarketplace(clone), true);
  assert.equal(readFileSync(join(clone, 'f.txt'), 'utf8'), '2');
  assert.equal(refreshMarketplace(join(clone, 'definitely-missing')), false);
});

test('run(): 全链路 — 刷新 marketplace、发现更新、输出 hook JSON、写 state', () => {
  // 1. 造一个 origin marketplace 仓库,demo 插件当前版本 1.0.0
  const origin = makeRepo();
  mkdirSync(join(origin, '.claude-plugin'), { recursive: true });
  mkdirSync(join(origin, 'plugins', 'demo'), { recursive: true });
  const manifest = {
    name: 'test-mkt',
    plugins: [{ name: 'demo', version: '1.0.0', source: './plugins/demo' }],
  };
  writeFileSync(join(origin, '.claude-plugin', 'marketplace.json'), JSON.stringify(manifest));
  git(origin, 'add', '.');
  git(origin, 'commit', '-m', 'm1');

  // 2. 造假配置目录:clone 作为 marketplace 缓存,已装版本 0.9.0(过期)
  const cfg = mkdtempSync(join(tmpdir(), 'uc-cfg-'));
  const pluginsDir = join(cfg, 'plugins');
  mkdirSync(join(pluginsDir, 'marketplaces'), { recursive: true });
  const mktDir = join(pluginsDir, 'marketplaces', 'test-mkt');
  execFileSync('git', ['clone', origin, mktDir], { stdio: 'ignore' });
  writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: { 'demo@test-mkt': [{ scope: 'user', version: '0.9.0', gitCommitSha: 'x'.repeat(40) }] },
  }));
  writeFileSync(join(pluginsDir, 'known_marketplaces.json'), JSON.stringify({
    'test-mkt': {
      source: { source: 'github', repo: 'a/b' },
      installLocation: mktDir,
      lastUpdated: new Date().toISOString(),
    },
  }));

  // 3. origin 上把 demo 升到 1.1.0 → run() 应先 pull 再发现更新
  manifest.plugins[0].version = '1.1.0';
  writeFileSync(join(origin, '.claude-plugin', 'marketplace.json'), JSON.stringify(manifest));
  git(origin, 'add', '.');
  git(origin, 'commit', '-m', 'm2');

  withConfigDir(cfg, () => {
    const out = run();
    assert.ok(out, '应产生提醒输出');
    assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(out.systemMessage, /demo 0\.9\.0 → 1\.1\.0 \(test-mkt\)/);
    assert.match(out.systemMessage, /claude plugin update demo@test-mkt/);

    // state.json 已写入且记录了刷新时间
    const state = JSON.parse(readFileSync(join(pluginsDir, 'data', 'update-checker', 'state.json'), 'utf8'));
    assert.ok(state.lastRefresh['test-mkt']);

    // 4. 已装版本追上后 → 静默(null)
    writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
      version: 2,
      plugins: { 'demo@test-mkt': [{ scope: 'user', version: '1.1.0', gitCommitSha: 'y'.repeat(40) }] },
    }));
    assert.equal(run(), null);
  });
});

test('run(): 状态文件缺失 → 静默 null', () => {
  const cfg = mkdtempSync(join(tmpdir(), 'uc-empty-'));
  withConfigDir(cfg, () => assert.equal(run(), null));
});

test('run(): 损坏 state.json(标量)与非字符串 installLocation → 不抛错,静默降级并重写合法 state', () => {
  const cfg = mkdtempSync(join(tmpdir(), 'uc-broken-'));
  const pluginsDir = join(cfg, 'plugins');
  mkdirSync(join(pluginsDir, 'data', 'update-checker'), { recursive: true });
  writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: { 'demo@test-mkt': [{ scope: 'user', version: '1.0.0', gitCommitSha: 'z'.repeat(40) }] },
  }));
  writeFileSync(join(pluginsDir, 'known_marketplaces.json'), JSON.stringify({
    'bad-mkt': { installLocation: 123 },
  }));
  writeFileSync(join(pluginsDir, 'data', 'update-checker', 'state.json'), '5');

  withConfigDir(cfg, () => {
    assert.equal(run(), null); // 不抛 TypeError;无可比对 marketplace → 静默
    const state = JSON.parse(readFileSync(join(pluginsDir, 'data', 'update-checker', 'state.json'), 'utf8'));
    assert.deepEqual(state, { lastRefresh: {}, lastFailure: {} });
  });
});

test('run(): 形态c(repo-check)— 插件子目录有变更 → "内容有更新";未变更 → 静默', () => {
  const origin = makeRepo();
  mkdirSync(join(origin, '.claude-plugin'), { recursive: true });
  mkdirSync(join(origin, 'skills', 'docsk'), { recursive: true });
  writeFileSync(join(origin, 'skills', 'docsk', 'SKILL.md'), 'v1');
  const manifest = {
    name: 'test-mkt-c',
    plugins: [{ name: 'docsk', source: './skills/docsk' }],
  };
  writeFileSync(join(origin, '.claude-plugin', 'marketplace.json'), JSON.stringify(manifest));
  git(origin, 'add', '.');
  git(origin, 'commit', '-m', 'm1');
  const sha1 = git(origin, 'rev-parse', 'HEAD').trim();

  const cfg = mkdtempSync(join(tmpdir(), 'uc-cfg-c-'));
  const pluginsDir = join(cfg, 'plugins');
  mkdirSync(join(pluginsDir, 'marketplaces'), { recursive: true });
  const mktDir = join(pluginsDir, 'marketplaces', 'test-mkt-c');
  execFileSync('git', ['clone', origin, mktDir], { stdio: 'ignore' });
  writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: { 'docsk@test-mkt-c': [{ scope: 'user', version: sha1.slice(0, 12), gitCommitSha: sha1 }] },
  }));
  writeFileSync(join(pluginsDir, 'known_marketplaces.json'), JSON.stringify({
    'test-mkt-c': {
      source: { source: 'github', repo: 'a/b' },
      installLocation: mktDir,
      lastUpdated: new Date().toISOString(),
    },
  }));

  withConfigDir(cfg, () => {
    // 1) 插件子目录无变更 → 静默
    assert.equal(run(), null);

    // 2) origin 新提交只改插件子目录;重置节流状态模拟次日 → pull 后发现"内容有更新"
    writeFileSync(join(origin, 'skills', 'docsk', 'SKILL.md'), 'v2');
    git(origin, 'add', '.');
    git(origin, 'commit', '-m', 'm2');
    writeFileSync(join(pluginsDir, 'data', 'update-checker', 'state.json'), '{}');

    const out = run();
    assert.ok(out, '应产生提醒');
    assert.match(out.systemMessage, /docsk .*→ 内容有更新 \(test-mkt-c\)/);
    assert.match(out.systemMessage, /claude plugin update docsk@test-mkt-c/);
  });
});

test('hook-entry: 空配置目录下 exit 0、stdout/stderr 均为空', () => {
  const cfg = mkdtempSync(join(tmpdir(), 'uc-entry-'));
  const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'hook-entry.mjs');
  const r = spawnSync(process.execPath, [entry], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('run(): sha 系误报自愈 — 更新后已装记录变化而 marketplace sha 未变 → 不再提醒;nag 保留;sha 再变 → 再提醒', () => {
  const origin = makeRepo();
  mkdirSync(join(origin, '.claude-plugin'), { recursive: true });
  const manifest = {
    name: 'test-mkt-a',
    plugins: [{ name: 'urlp', source: { source: 'url', url: 'https://example.com/x.git', sha: 'a'.repeat(40) } }],
  };
  writeFileSync(join(origin, '.claude-plugin', 'marketplace.json'), JSON.stringify(manifest));
  git(origin, 'add', '.');
  git(origin, 'commit', '-m', 'm1');

  const cfg = mkdtempSync(join(tmpdir(), 'uc-cfg-a-'));
  const pluginsDir = join(cfg, 'plugins');
  mkdirSync(join(pluginsDir, 'marketplaces'), { recursive: true });
  const mktDir = join(pluginsDir, 'marketplaces', 'test-mkt-a');
  execFileSync('git', ['clone', origin, mktDir], { stdio: 'ignore' });
  const installedPath = join(pluginsDir, 'installed_plugins.json');
  const writeInstalled = (version, lastUpdated) => writeFileSync(installedPath, JSON.stringify({
    version: 2,
    plugins: { 'urlp@test-mkt-a': [{ scope: 'user', version, gitCommitSha: 'b'.repeat(40), lastUpdated }] },
  }));
  writeFileSync(join(pluginsDir, 'known_marketplaces.json'), JSON.stringify({
    'test-mkt-a': {
      source: { source: 'github', repo: 'a/b' },
      installLocation: mktDir,
      lastUpdated: new Date().toISOString(),
    },
  }));

  withConfigDir(cfg, () => {
    // 1) 已装 sha(b) ≠ 条目 sha(a) → 提醒
    writeInstalled('5.1.0', '2026-06-24T09:17:06.080Z');
    const out1 = run();
    assert.ok(out1);
    assert.match(out1.systemMessage, /urlp 5\.1\.0 → aaaaaaaaaaaa \(test-mkt-a\)/);

    // 1b) 已装记录未变 → 继续提醒(nag)
    assert.ok(run());

    // 2) 模拟 claude plugin update:version/lastUpdated 变化但 gitCommitSha 陈旧(真机 bug 复现)→ 静默
    writeInstalled('7.0.2', new Date().toISOString());
    assert.equal(run(), null);

    // 3) marketplace sha 再变 → 重新提醒。
    // 真实时间线:用户上次更新早于新 pin 出现,故把 lastUpdated 回拨到新 pin 之前;
    // 重置刷新节流以触发 pull。显式日期避免 git 秒级提交时间与毫秒级 lastUpdated 的同秒歧义。
    manifest.plugins[0].source.sha = 'c'.repeat(40);
    writeFileSync(join(origin, '.claude-plugin', 'marketplace.json'), JSON.stringify(manifest));
    git(origin, 'add', '.');
    git(origin, 'commit', '-m', 'm2');
    writeInstalled('7.0.2', '2020-01-01T00:00:00.000Z');
    const statePath = join(pluginsDir, 'data', 'update-checker', 'state.json');
    const st = JSON.parse(readFileSync(statePath, 'utf8'));
    st.lastRefresh = {};
    writeFileSync(statePath, JSON.stringify(st));
    const out3 = run();
    assert.ok(out3);
    assert.match(out3.systemMessage, /urlp 7\.0\.2 → cccccccccccc \(test-mkt-a\)/);
  });
});

test('run(): state 嵌套字段损坏(lastRefresh 标量/lastFailure 数组)→ 不抛错,降级并自愈重写', () => {
  const cfg = mkdtempSync(join(tmpdir(), 'uc-nested-'));
  const pluginsDir = join(cfg, 'plugins');
  mkdirSync(join(pluginsDir, 'data', 'update-checker'), { recursive: true });
  writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: { 'demo@test-mkt': [{ scope: 'user', version: '1.0.0', gitCommitSha: 'z'.repeat(40) }] },
  }));
  writeFileSync(join(pluginsDir, 'known_marketplaces.json'), JSON.stringify({}));
  writeFileSync(join(pluginsDir, 'data', 'update-checker', 'state.json'), '{"lastRefresh":5,"lastFailure":[]}');

  withConfigDir(cfg, () => {
    assert.equal(run(), null);
    const state = JSON.parse(readFileSync(join(pluginsDir, 'data', 'update-checker', 'state.json'), 'utf8'));
    assert.deepEqual(state, { lastRefresh: {}, lastFailure: {} });
  });
});

test('isCaughtUp: 晚于 → true;早于/相等 → false;无效 → false', () => {
  assert.equal(isCaughtUp('2026-11-16T06:38:30Z', '2026-11-12T18:05:32Z'), true);
  assert.equal(isCaughtUp('2026-11-12T18:05:32Z', '2026-11-16T06:38:30Z'), false);
  assert.equal(isCaughtUp('2026-11-12T18:05:32Z', '2026-11-12T18:05:32Z'), false);
  assert.equal(isCaughtUp(undefined, '2026-11-12T18:05:32Z'), false);
  assert.equal(isCaughtUp('2026-11-16T06:38:30Z', null), false);
  assert.equal(isCaughtUp('bad', 'bad'), false);
});

test('targetDate: pickaxe 找 sha 引入日期;子目录最后变更日期;找不到/非仓库 → null', () => {
  const repo = makeRepo();
  mkdirSync(join(repo, '.claude-plugin'), { recursive: true });
  mkdirSync(join(repo, 'plugins', 'foo'), { recursive: true });
  writeFileSync(join(repo, '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins: [{ name: 'x', source: { source: 'url', sha: 'e'.repeat(40) } }] }));
  writeFileSync(join(repo, 'plugins', 'foo', 'a.txt'), '1');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'c1');
  const d1 = targetDate(repo, [`-S${'e'.repeat(40)}`, '--', '.claude-plugin/marketplace.json']);
  assert.ok(d1 && !Number.isNaN(Date.parse(d1)));
  const d2 = targetDate(repo, ['--', 'plugins/foo']);
  assert.ok(d2 && !Number.isNaN(Date.parse(d2)));
  assert.equal(targetDate(repo, [`-S${'f'.repeat(40)}`, '--', '.claude-plugin/marketplace.json']), null);
  assert.equal(targetDate(join(repo, 'nope'), ['--', 'plugins/foo']), null);
});

test('run(): 部署前已更新(形态a)— lastUpdated 晚于 pin 引入日期 → 首跑即不误报', () => {
  const origin = makeRepo();
  mkdirSync(join(origin, '.claude-plugin'), { recursive: true });
  const manifest = {
    name: 'test-mkt-pre',
    plugins: [{ name: 'urlp', source: { source: 'url', url: 'https://example.com/x.git', sha: 'a'.repeat(40) } }],
  };
  writeFileSync(join(origin, '.claude-plugin', 'marketplace.json'), JSON.stringify(manifest));
  git(origin, 'add', '.');
  git(origin, 'commit', '-m', 'm1');

  const cfg = mkdtempSync(join(tmpdir(), 'uc-pre-'));
  const pluginsDir = join(cfg, 'plugins');
  mkdirSync(join(pluginsDir, 'marketplaces'), { recursive: true });
  const mktDir = join(pluginsDir, 'marketplaces', 'test-mkt-pre');
  execFileSync('git', ['clone', origin, mktDir], { stdio: 'ignore' });
  writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
    version: 2,
    // 更新发生在"产品首次运行之前":sha 陈旧,lastUpdated 晚于 pin 提交时间
    plugins: { 'urlp@test-mkt-pre': [{ scope: 'user', version: '7.0.2', gitCommitSha: 'b'.repeat(40), lastUpdated: new Date(Date.now() + 3600 * 1000).toISOString() }] },
  }));
  writeFileSync(join(pluginsDir, 'known_marketplaces.json'), JSON.stringify({
    'test-mkt-pre': { source: { source: 'github', repo: 'a/b' }, installLocation: mktDir, lastUpdated: new Date().toISOString() },
  }));

  withConfigDir(cfg, () => {
    assert.equal(run(), null);
  });
});

test('run(): 形态c 已跟上 — 子目录有变更但 lastUpdated 晚于其最后变更时间 → 静默;早于 → 提醒', () => {
  const origin = makeRepo();
  mkdirSync(join(origin, '.claude-plugin'), { recursive: true });
  mkdirSync(join(origin, 'plugins', 'demo'), { recursive: true });
  writeFileSync(join(origin, 'plugins', 'demo', 'a.txt'), '1');
  const manifest = { name: 'test-mkt-cr', plugins: [{ name: 'demo', source: './plugins/demo' }] };
  writeFileSync(join(origin, '.claude-plugin', 'marketplace.json'), JSON.stringify(manifest));
  git(origin, 'add', '.');
  git(origin, 'commit', '-m', 'm1');
  const sha1 = git(origin, 'rev-parse', 'HEAD').trim();

  const cfg = mkdtempSync(join(tmpdir(), 'uc-cr-'));
  const pluginsDir = join(cfg, 'plugins');
  mkdirSync(join(pluginsDir, 'marketplaces'), { recursive: true });
  const mktDir = join(pluginsDir, 'marketplaces', 'test-mkt-cr');
  execFileSync('git', ['clone', origin, mktDir], { stdio: 'ignore' });
  const installedPath = join(pluginsDir, 'installed_plugins.json');
  const writeInstalled = (lastUpdated) => writeFileSync(installedPath, JSON.stringify({
    version: 2,
    plugins: { 'demo@test-mkt-cr': [{ scope: 'user', version: sha1.slice(0, 12), gitCommitSha: sha1, lastUpdated }] },
  }));
  writeFileSync(join(pluginsDir, 'known_marketplaces.json'), JSON.stringify({
    'test-mkt-cr': { source: { source: 'github', repo: 'a/b' }, installLocation: mktDir, lastUpdated: new Date().toISOString() },
  }));

  writeFileSync(join(origin, 'plugins', 'demo', 'a.txt'), '2');
  git(origin, 'add', '.');
  git(origin, 'commit', '-m', 'm2');

  withConfigDir(cfg, () => {
    // lastUpdated 早于子目录变更 → 提醒
    writeInstalled('2020-01-01T00:00:00.000Z');
    const out = run();
    assert.ok(out);
    assert.match(out.systemMessage, /demo .*→ 内容有更新 \(test-mkt-cr\)/);

    // 模拟更新完成(sha 未回写),lastUpdated 晚于变更时间 → 静默
    writeInstalled(new Date(Date.now() + 3600 * 1000).toISOString());
    const statePath = join(pluginsDir, 'data', 'update-checker', 'state.json');
    const st = JSON.parse(readFileSync(statePath, 'utf8'));
    st.lastRefresh = {};
    writeFileSync(statePath, JSON.stringify(st));
    assert.equal(run(), null);
  });
});

test('installedVersion: 读安装目录 plugin.json;缺失/无 version/非法路径 → null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uc-iv-'));
  assert.equal(installedVersion(dir), null);
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'x', version: '2.3.4' }));
  assert.equal(installedVersion(dir), '2.3.4');
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'x' }));
  assert.equal(installedVersion(dir), null);
  assert.equal(installedVersion(undefined), null);
  assert.equal(installedVersion(123), null);
});

test('run(): 记录 version 陈旧但安装目录 plugin.json 已最新 → 静默(diverge 自愈)', () => {
  const origin = makeRepo();
  mkdirSync(join(origin, '.claude-plugin'), { recursive: true });
  const manifest = { name: 'test-mkt-dv', plugins: [{ name: 'demo', version: '1.0.0', source: './plugins/demo' }] };
  writeFileSync(join(origin, '.claude-plugin', 'marketplace.json'), JSON.stringify(manifest));
  git(origin, 'add', '.');
  git(origin, 'commit', '-m', 'm1');

  const cfg = mkdtempSync(join(tmpdir(), 'uc-dv-'));
  const pluginsDir = join(cfg, 'plugins');
  mkdirSync(join(pluginsDir, 'marketplaces'), { recursive: true });
  const mktDir = join(pluginsDir, 'marketplaces', 'test-mkt-dv');
  execFileSync('git', ['clone', origin, mktDir], { stdio: 'ignore' });

  // 安装目录真实 plugin.json 是 1.0.0,记录字段却是 0.9.0(模拟 diverge)
  const installPath = join(pluginsDir, 'cache', 'test-mkt-dv', 'demo', '1.0.0');
  mkdirSync(join(installPath, '.claude-plugin'), { recursive: true });
  writeFileSync(join(installPath, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
  writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: { 'demo@test-mkt-dv': [{ scope: 'user', version: '0.9.0', gitCommitSha: 'z'.repeat(40), installPath }] },
  }));
  writeFileSync(join(pluginsDir, 'known_marketplaces.json'), JSON.stringify({
    'test-mkt-dv': { source: { source: 'github', repo: 'a/b' }, installLocation: mktDir, lastUpdated: new Date().toISOString() },
  }));

  withConfigDir(cfg, () => {
    assert.equal(run(), null);
  });
});

test('resolveLang: env 覆盖 zh/en;非法覆盖回退 locale;zh* → zh;其余 → en', () => {
  assert.equal(resolveLang({ UPDATE_CHECKER_LANG: 'en' }, 'zh-CN'), 'en');
  assert.equal(resolveLang({ UPDATE_CHECKER_LANG: 'zh' }, 'en-US'), 'zh');
  assert.equal(resolveLang({ UPDATE_CHECKER_LANG: 'fr' }, 'zh-CN'), 'zh');
  assert.equal(resolveLang({}, 'zh-Hans-CN'), 'zh');
  assert.equal(resolveLang({}, 'en-US'), 'en');
  assert.equal(resolveLang({}, undefined), 'en');
});

test('buildOutput: 英文文案(单复数/命令标签/重启行/stale 附注/转达指令)', () => {
  const one = buildOutput([{ plugin: 'demo@mkt', from: '1.0.0', to: '1.1.0' }], [], 'en');
  assert.match(one.systemMessage, /🔄 1 Claude Code plugin update available:/);
  assert.match(one.systemMessage, /Update commands:/);
  assert.match(one.systemMessage, /Restart the session or run \/reload-plugins after updating\./);
  const two = buildOutput(
    [{ plugin: 'a@m', from: '1', to: '2' }, { plugin: 'b@m', from: '1', to: '2' }],
    [['m', 1, false]],
    'en',
  );
  assert.match(two.systemMessage, /🔄 2 Claude Code plugin updates available:/);
  assert.match(two.systemMessage, /\(note: m version info is 1 day old and may be inaccurate\)/);
  assert.match(two.hookSpecificOutput.additionalContext, /Relay the following reminder to the user verbatim/);
  assert.match(two.hookSpecificOutput.additionalContext, /When the user asks to update, run the claude plugin update commands above one by one\./);
  assert.equal(two.hookSpecificOutput.hookEventName, 'SessionStart');
});

test('targetDate: merge-only 变更计入(--diff-merges=first-parent)', () => {
  const repo = makeRepo();
  const gitDate = (date, ...args) => execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  mkdirSync(join(repo, 'plugins', 'foo'), { recursive: true });
  writeFileSync(join(repo, 'plugins', 'foo', 'a.txt'), '1');
  gitDate('2026-01-01T00:00:00Z', 'add', '.');
  gitDate('2026-01-01T00:00:00Z', 'commit', '-m', 'c1');
  gitDate('2026-01-01T01:00:00Z', 'checkout', '-b', 'side');
  writeFileSync(join(repo, 'plugins', 'foo', 'a.txt'), '2');
  gitDate('2026-01-01T01:00:00Z', 'add', '.');
  gitDate('2026-01-01T01:00:00Z', 'commit', '-m', 'c2');
  gitDate('2026-01-02T00:00:00Z', 'checkout', 'main');
  gitDate('2026-01-02T00:00:00Z', 'merge', '--no-ff', 'side', '-m', 'merge');
  const mergeDate = Date.parse(gitDate('2026-01-02T00:00:00Z', 'log', '-1', '--format=%cI', 'HEAD').trim());
  const d = targetDate(repo, ['--', 'plugins/foo']);
  assert.ok(d);
  assert.equal(Date.parse(d), mergeDate);
});

test('buildOutput: stale 附注点名刷新失败(zh/en)', () => {
  const u = [{ plugin: 'a@m', from: '1', to: '2' }];
  const zh = buildOutput(u, [['m', 5, true]], 'zh');
  assert.match(zh.systemMessage, /注:m 刷新失败,版本信息已过期 5 天,可能不准/);
  const en = buildOutput(u, [['m', 5, true]], 'en');
  assert.match(en.systemMessage, /note: m refresh failed; version info is 5 days old and may be inaccurate/);
});

test('loadIgnore: 缺失/损坏/非数组 → [];过滤非字符串', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uc-ig-'));
  assert.deepEqual(loadIgnore(dir), []);
  writeFileSync(join(dir, 'update-checker.json'), '{broken');
  assert.deepEqual(loadIgnore(dir), []);
  writeFileSync(join(dir, 'update-checker.json'), JSON.stringify({ ignore: 'x' }));
  assert.deepEqual(loadIgnore(dir), []);
  writeFileSync(join(dir, 'update-checker.json'), JSON.stringify({ ignore: ['a', 5, 'b'] }));
  assert.deepEqual(loadIgnore(dir), ['a', 'b']);
});

test('run(): ignore 配置跳过 marketplace 与插件 key;非法配置不生效', () => {
  const origin = makeRepo();
  mkdirSync(join(origin, '.claude-plugin'), { recursive: true });
  const manifest = { name: 'ig-mkt', plugins: [{ name: 'demo', version: '1.0.0', source: './plugins/demo' }] };
  writeFileSync(join(origin, '.claude-plugin', 'marketplace.json'), JSON.stringify(manifest));
  git(origin, 'add', '.');
  git(origin, 'commit', '-m', 'm1');
  const cfg = mkdtempSync(join(tmpdir(), 'uc-ig-e2e-'));
  const pluginsDir = join(cfg, 'plugins');
  mkdirSync(join(pluginsDir, 'marketplaces'), { recursive: true });
  const mktDir = join(pluginsDir, 'marketplaces', 'ig-mkt');
  execFileSync('git', ['clone', origin, mktDir], { stdio: 'ignore' });
  writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: { 'demo@ig-mkt': [{ scope: 'user', version: '0.9.0', gitCommitSha: 'z'.repeat(40) }] },
  }));
  writeFileSync(join(pluginsDir, 'known_marketplaces.json'), JSON.stringify({
    'ig-mkt': { source: { source: 'github', repo: 'a/b' }, installLocation: mktDir, lastUpdated: new Date().toISOString() },
  }));
  writeFileSync(join(cfg, 'update-checker.json'), JSON.stringify({ ignore: ['ig-mkt'] }));
  withConfigDir(cfg, () => assert.equal(run(), null));
  writeFileSync(join(cfg, 'update-checker.json'), JSON.stringify({ ignore: ['demo@ig-mkt'] }));
  withConfigDir(cfg, () => assert.equal(run(), null));
  writeFileSync(join(cfg, 'update-checker.json'), JSON.stringify({ ignore: 'not-array' }));
  withConfigDir(cfg, () => assert.ok(run()));
});

test('run(): 只读比对阶段零改动(marketplace 工作树/HEAD 与安装目录)', () => {
  const origin = makeRepo();
  mkdirSync(join(origin, '.claude-plugin'), { recursive: true });
  mkdirSync(join(origin, 'plugins', 'demo'), { recursive: true });
  writeFileSync(join(origin, 'plugins', 'demo', 'plugin.txt'), 'x');
  const manifest = { name: 'ro-mkt', plugins: [{ name: 'demo', version: '1.0.0', source: './plugins/demo' }] };
  writeFileSync(join(origin, '.claude-plugin', 'marketplace.json'), JSON.stringify(manifest));
  git(origin, 'add', '.');
  git(origin, 'commit', '-m', 'm1');
  const cfg = mkdtempSync(join(tmpdir(), 'uc-ro-'));
  const pluginsDir = join(cfg, 'plugins');
  mkdirSync(join(pluginsDir, 'marketplaces'), { recursive: true });
  const mktDir = join(pluginsDir, 'marketplaces', 'ro-mkt');
  execFileSync('git', ['clone', origin, mktDir], { stdio: 'ignore' });
  const installPath = join(pluginsDir, 'cache', 'ro-mkt', 'demo', '1.0.0');
  mkdirSync(join(installPath, '.claude-plugin'), { recursive: true });
  writeFileSync(join(installPath, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
  writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: { 'demo@ro-mkt': [{ scope: 'user', version: '1.0.0', gitCommitSha: git(origin, 'rev-parse', 'HEAD').trim(), installPath }] },
  }));
  writeFileSync(join(pluginsDir, 'known_marketplaces.json'), JSON.stringify({
    'ro-mkt': { source: { source: 'github', repo: 'a/b' }, installLocation: mktDir, lastUpdated: new Date().toISOString() },
  }));
  mkdirSync(join(pluginsDir, 'data', 'update-checker'), { recursive: true });
  writeFileSync(join(pluginsDir, 'data', 'update-checker', 'state.json'), JSON.stringify({ lastRefresh: { 'ro-mkt': new Date().toISOString() } }));
  const snap = () => ({
    status: git(mktDir, 'status', '--porcelain'),
    head: git(mktDir, 'rev-parse', 'HEAD'),
    installed: readFileSync(join(installPath, '.claude-plugin', 'plugin.json'), 'utf8'),
  });
  const before = snap();
  withConfigDir(cfg, () => assert.equal(run(), null));
  assert.deepEqual(snap(), before);
});

test('buildOutput: zh/en 结构 parity(行数/bullet/命令/键结构)', () => {
  const u = [{ plugin: 'a@m', from: '1.0', to: '2.0' }, { plugin: 'b@m', from: '1', to: '2' }];
  const s = [['m', 3, true]];
  const zh = buildOutput(u, s, 'zh');
  const en = buildOutput(u, s, 'en');
  const zl = zh.systemMessage.split('\n'), el = en.systemMessage.split('\n');
  assert.equal(zl.length, el.length);
  assert.deepEqual(zl.filter((l) => l.startsWith('  • ')), el.filter((l) => l.startsWith('  • ')));
  assert.deepEqual(zl.filter((l) => l.startsWith('  claude plugin update ')), el.filter((l) => l.startsWith('  claude plugin update ')));
  assert.equal(zh.hookSpecificOutput.additionalContext.split('\n').length, en.hookSpecificOutput.additionalContext.split('\n').length);
  assert.equal(zh.hookSpecificOutput.hookEventName, en.hookSpecificOutput.hookEventName);
});

test('manifest: marketplace 条目 version 与 plugin.json 一致', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const mp = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const pj = JSON.parse(readFileSync(join(root, 'plugins', 'update-checker', '.claude-plugin', 'plugin.json'), 'utf8'));
  const entry = mp.plugins.find((p) => p.name === pj.name);
  assert.ok(entry);
  assert.equal(entry.version, pj.version);
});

test('hook-entry fixture: 过期 installed → 提醒 JSON(zh 固定,CI 任意 locale 稳定)', () => {
  const origin = makeRepo();
  mkdirSync(join(origin, '.claude-plugin'), { recursive: true });
  const manifest = { name: 'hf-mkt', plugins: [{ name: 'demo', version: '1.0.0', source: './plugins/demo' }] };
  writeFileSync(join(origin, '.claude-plugin', 'marketplace.json'), JSON.stringify(manifest));
  git(origin, 'add', '.');
  git(origin, 'commit', '-m', 'm1');
  const cfg = mkdtempSync(join(tmpdir(), 'uc-hf-stale-'));
  const pluginsDir = join(cfg, 'plugins');
  mkdirSync(join(pluginsDir, 'marketplaces'), { recursive: true });
  const mktDir = join(pluginsDir, 'marketplaces', 'hf-mkt');
  execFileSync('git', ['clone', origin, mktDir], { stdio: 'ignore' });
  writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: { 'demo@hf-mkt': [{ scope: 'user', version: '0.9.0', gitCommitSha: 'z'.repeat(40), lastUpdated: '2020-01-01T00:00:00.000Z' }] },
  }));
  writeFileSync(join(pluginsDir, 'known_marketplaces.json'), JSON.stringify({
    'hf-mkt': { source: { source: 'github', repo: 'a/b' }, installLocation: mktDir, lastUpdated: new Date().toISOString() },
  }));
  const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'hook-entry.mjs');
  const r = spawnSync(process.execPath, [entry], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, UPDATE_CHECKER_LANG: 'zh' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  const out = JSON.parse(r.stdout);
  assert.match(out.systemMessage, /demo 0\.9\.0 → 1\.0\.0 \(hf-mkt\)/);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
});

test('hook-entry fixture: 全部最新 → 空 stdout、exit 0、空 stderr', () => {
  const origin = makeRepo();
  mkdirSync(join(origin, '.claude-plugin'), { recursive: true });
  const manifest = { name: 'hf-mkt2', plugins: [{ name: 'demo', version: '1.0.0', source: './plugins/demo' }] };
  writeFileSync(join(origin, '.claude-plugin', 'marketplace.json'), JSON.stringify(manifest));
  git(origin, 'add', '.');
  git(origin, 'commit', '-m', 'm1');
  const cfg = mkdtempSync(join(tmpdir(), 'uc-hf-cur-'));
  const pluginsDir = join(cfg, 'plugins');
  mkdirSync(join(pluginsDir, 'marketplaces'), { recursive: true });
  const mktDir = join(pluginsDir, 'marketplaces', 'hf-mkt2');
  execFileSync('git', ['clone', origin, mktDir], { stdio: 'ignore' });
  const installPath = join(pluginsDir, 'cache', 'hf-mkt2', 'demo', '1.0.0');
  mkdirSync(join(installPath, '.claude-plugin'), { recursive: true });
  writeFileSync(join(installPath, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
  writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: { 'demo@hf-mkt2': [{ scope: 'user', version: '1.0.0', gitCommitSha: git(origin, 'rev-parse', 'HEAD').trim(), installPath }] },
  }));
  writeFileSync(join(pluginsDir, 'known_marketplaces.json'), JSON.stringify({
    'hf-mkt2': { source: { source: 'github', repo: 'a/b' }, installLocation: mktDir, lastUpdated: new Date().toISOString() },
  }));
  const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'hook-entry.mjs');
  const r = spawnSync(process.execPath, [entry], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, UPDATE_CHECKER_LANG: 'zh' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('buildOutput: 来源溯源行(github/local/未知省略,zh/en)', () => {
  const u = [
    { plugin: 'a@m1', from: '1', to: '2', src: 'owner/repo1' },
    { plugin: 'b@m2', from: '1', to: '2', src: 'local directory' },
    { plugin: 'c@m3', from: '1', to: '2' },
  ];
  const zh = buildOutput(u, [], 'zh');
  assert.match(zh.systemMessage, /来源: m1=owner\/repo1; m2=local directory/);
  assert.ok(!zh.systemMessage.includes('m3='));
  const en = buildOutput(u, [], 'en');
  assert.match(en.systemMessage, /sources: m1=owner\/repo1; m2=local directory/);
  const none = buildOutput([{ plugin: 'c@m3', from: '1', to: '2' }], [], 'zh');
  assert.ok(!none.systemMessage.includes('来源'));
});

test('run(): 提醒带 marketplace 来源行(github repo)', () => {
  const origin = makeRepo();
  mkdirSync(join(origin, '.claude-plugin'), { recursive: true });
  const manifest = { name: 'pv-mkt', plugins: [{ name: 'demo', version: '1.0.0', source: './plugins/demo' }] };
  writeFileSync(join(origin, '.claude-plugin', 'marketplace.json'), JSON.stringify(manifest));
  git(origin, 'add', '.');
  git(origin, 'commit', '-m', 'm1');
  const cfg = mkdtempSync(join(tmpdir(), 'uc-pv-'));
  const pluginsDir = join(cfg, 'plugins');
  mkdirSync(join(pluginsDir, 'marketplaces'), { recursive: true });
  const mktDir = join(pluginsDir, 'marketplaces', 'pv-mkt');
  execFileSync('git', ['clone', origin, mktDir], { stdio: 'ignore' });
  writeFileSync(join(pluginsDir, 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: { 'demo@pv-mkt': [{ scope: 'user', version: '0.9.0', gitCommitSha: 'z'.repeat(40) }] },
  }));
  writeFileSync(join(pluginsDir, 'known_marketplaces.json'), JSON.stringify({
    'pv-mkt': { source: { source: 'github', repo: 'owner/pv-repo' }, installLocation: mktDir, lastUpdated: new Date().toISOString() },
  }));
  withConfigDir(cfg, () => {
    const out = run();
    assert.ok(out);
    assert.match(out.systemMessage, /来源: pv-mkt=owner\/pv-repo/);
  });
});
