# plugin-update-checker 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个可分发的 Claude Code 插件产品:每次会话启动时检查本机所有已装插件(含第三方 marketplace)是否有更新,通过 systemMessage + additionalContext 双通道提醒,并给出可执行的更新命令。

**Architecture:** 产品仓库本身是一个 marketplace(根 `.claude-plugin/marketplace.json`),内含单个插件 `update-checker`。插件通过 `hooks/hooks.json` 注册 SessionStart hook,hook 入口 `hook-entry.mjs` 调用核心纯模块 `check-updates.mjs` 的 `run()`:读取本机 `~/.claude/plugins/` 状态文件 → 对超过 24h 未刷新的 marketplace git 仓库做 `git pull --ff-only`(节流+10s 总预算)→ 按三种条目形态比对版本 → 有更新则输出 hook JSON。任何错误静默降级,恒 exit 0。

**Tech Stack:** Node.js ≥18(ESM,零依赖,node:test)、git、Claude Code 插件机制(hooks.json / marketplace.json / plugin.json)。

**Spec:** `docs/superpowers/specs/2026-11-13-plugin-update-checker-design.md`(含已验证的本机文件真实形态,附录 A)

---

## 前置条件(执行者必读)

1. 所有命令在 **Git Bash** 中、仓库根目录 `d:\zhuocheng\test\pull_all_the_time` 下运行。
2. **当前权限模式可能挡住 Bash**(auto 模式安全检查不可用)。执行前先确认 Bash 可用;被挡时请用户切换权限模式。
3. 验证环境:`node --version`(期望 ≥ v18)和 `git --version`(期望可执行)。
4. 本机真实环境即为 dogfood 样本:装有 4 个过期插件(superpowers 5.1.0 等),3 个 marketplace 缓存停在 2026 年 5-6 月。
5. 计划中 `<owner>` 指用户的 GitHub 用户名,**仅在 Task 8 发布步骤需要,执行到那一步时向用户询问**,其余任务不涉及。

## 文件结构(全仓库)

```
d:\zhuocheng\test\pull_all_the_time\     ← 仓库根 = marketplace
├── .claude-plugin\marketplace.json       ← marketplace 清单(Task 1)
├── .gitignore                            ← Task 1
├── LICENSE                               ← MIT,Task 1
├── README.md                             ← 产品说明,由 readme.md 重命名改写(Task 8)
├── docs\superpowers\specs\...design.md   ← 已存在,随首次提交入库
├── docs\superpowers\plans\...md          ← 本文件,随首次提交入库
└── plugins\update-checker\
    ├── .claude-plugin\plugin.json        ← 插件清单(Task 1)
    ├── hooks\hooks.json                  ← SessionStart 注册(Task 1)
    ├── scripts\check-updates.mjs         ← 核心纯模块(Task 2-6 渐进构建)
    ├── scripts\hook-entry.mjs            ← hook 入口薄壳(Task 6)
    └── tests\check-updates.test.mjs      ← 测试(Task 2-6 渐进累积)
```

职责边界:`check-updates.mjs` 只做纯逻辑与受控副作用(读文件/git 子进程),不直接产出进程退出行为;`hook-entry.mjs` 只负责异常兜底与输出/退出;测试文件累积全部单元+集成测试。

---

### Task 1: git 仓库初始化 + 清单/许可文件

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Create: `plugins/update-checker/.claude-plugin/plugin.json`
- Create: `plugins/update-checker/hooks/hooks.json`
- Create: `.gitignore`
- Create: `LICENSE`

- [ ] **Step 1: 初始化 git 仓库(main 分支)**

```bash
git init
git symbolic-ref HEAD refs/heads/main
```

预期:无报错;`git status` 显示未跟踪文件(含 docs/ 下已有的 spec 与本计划)。

- [ ] **Step 2: 写 `.claude-plugin/marketplace.json`**

```json
{
  "name": "plugin-update-checker",
  "owner": { "name": "yangzhuocheng" },
  "plugins": [
    {
      "name": "update-checker",
      "source": "./plugins/update-checker",
      "description": "Reminds you about available updates for all installed Claude Code plugins at session start, across every marketplace you have registered.",
      "category": "productivity"
    }
  ]
}
```

- [ ] **Step 3: 写 `plugins/update-checker/.claude-plugin/plugin.json`**

```json
{
  "name": "update-checker",
  "version": "0.1.0",
  "description": "Session-start update reminders for all installed Claude Code plugins.",
  "author": { "name": "yangzhuocheng" }
}
```

- [ ] **Step 4: 写 `plugins/update-checker/hooks/hooks.json`**

(引用的 `hook-entry.mjs` 在 Task 6 才创建;hook 只在插件安装后触发,顺序无碍。)

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hook-entry.mjs\""
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 5: 写 `.gitignore`**

```
node_modules/
*.log
.DS_Store
```

- [ ] **Step 6: 写 `LICENSE`(MIT 全文)**

```
MIT License

Copyright (c) 2026 yangzhuocheng

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 7: 验证三个 JSON 可解析**

```bash
node -e "const fs=require('fs');for(const p of ['.claude-plugin/marketplace.json','plugins/update-checker/.claude-plugin/plugin.json','plugins/update-checker/hooks/hooks.json']){JSON.parse(fs.readFileSync(p,'utf8'));console.log('OK',p)}"
```

预期输出:
```
OK .claude-plugin/marketplace.json
OK plugins/update-checker/.claude-plugin/plugin.json
OK plugins/update-checker/hooks/hooks.json
```

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "chore: scaffold marketplace/plugin manifests, license, docs"
```

---

### Task 2: 核心模块骨架 + 节流判定(TDD)

**Files:**
- Create: `plugins/update-checker/scripts/check-updates.mjs`
- Create: `plugins/update-checker/tests/check-updates.test.mjs`

- [ ] **Step 1: 写失败的测试文件(完整初始内容)**

`plugins/update-checker/tests/check-updates.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
```

- [ ] **Step 2: 运行,确认失败**

```bash
node --test plugins/update-checker/tests/check-updates.test.mjs
```

预期:FAIL,报 `Cannot find module .../check-updates.mjs`(实现尚不存在)。

- [ ] **Step 3: 写最小实现(文件完整初始内容)**

`plugins/update-checker/scripts/check-updates.mjs`:

```js
// check-updates.mjs — plugin-update-checker 核心逻辑。
// 纯模块:导出函数,不主动执行;hook 入口见 hook-entry.mjs。
import { readFileSync } from 'node:fs';

export const TTL_MS = 24 * 60 * 60 * 1000;     // marketplace 刷新节流间隔(24h)
export const FAILURE_RETRY_MS = 60 * 60 * 1000; // 刷新失败后的重试间隔(1h)

export function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// 距上次成功刷新 >= ttl 才需要刷新;无记录/坏记录视为需要
export function needsRefresh(state, name, now, ttlMs = TTL_MS) {
  const t = Date.parse(state?.lastRefresh?.[name] ?? '');
  if (Number.isNaN(t)) return true;
  return now - t >= ttlMs;
}

// 最近 1h 内失败过 → 跳过本次尝试,避免离线时每次启动都吃超时
export function recentFailure(state, name, now) {
  const t = Date.parse(state?.lastFailure?.[name] ?? '');
  return !Number.isNaN(t) && now - t < FAILURE_RETRY_MS;
}
```

- [ ] **Step 4: 运行,确认通过**

```bash
node --test plugins/update-checker/tests/check-updates.test.mjs
```

预期:`pass 6`,`fail 0`。

- [ ] **Step 5: 提交**

```bash
git add plugins/update-checker/scripts/check-updates.mjs plugins/update-checker/tests/check-updates.test.mjs
git commit -m "feat: core module skeleton with throttled-refresh state helpers"
```

---

### Task 3: comparePlugin 比对规则 1-3(TDD)+ Task 2 审查缺口回填

**Files:**
- Modify: `plugins/update-checker/scripts/check-updates.mjs`(文件末尾追加)
- Modify: `plugins/update-checker/tests/check-updates.test.mjs`(追加测试、替换 import 区)

- [ ] **Step 0(前置):回填 Task 2 质量审查发现的测试缺口**

把测试文件开头的 import 区(原 `import { test } ...` 与 `import assert ...` 两行及模块 import 语句)整体替换为:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  needsRefresh, recentFailure, readJsonSafe, TTL_MS,
} from '../scripts/check-updates.mjs';
```

测试文件末尾追加(这些测试针对已存在的实现,立即通过,属覆盖率回填而非 TDD 违例):

```js
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
```

运行 `node --test plugins/update-checker/tests/check-updates.test.mjs`,预期 `pass 9`,`fail 0`。提交:

```bash
git add plugins/update-checker/tests/check-updates.test.mjs
git commit -m "test: backfill readJsonSafe corrupt-JSON, TTL lock, recentFailure null-state coverage"
```

- [ ] **Step 1: 追加失败的测试**

把测试文件开头 import 区中来自 `'../scripts/check-updates.mjs'` 的 import 语句替换为(其余 node 内置 import 保留不动):

```js
import {
  needsRefresh, recentFailure, readJsonSafe, TTL_MS,
  comparePlugin,
} from '../scripts/check-updates.mjs';
```

并在测试文件末尾追加:

```js
test('comparePlugin: 条目缺失 → skip', () => {
  const r = comparePlugin({ version: '1.0.0', gitCommitSha: 'abc' }, null);
  assert.equal(r.status, 'skip');
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
  assert.equal(comparePlugin({ gitCommitSha: 'a' }, { name: 'x', source: { source: 'url', url: 'u' } }).status, 'skip');
});
```

- [ ] **Step 2: 运行,确认失败**

```bash
node --test plugins/update-checker/tests/check-updates.test.mjs
```

预期:FAIL,报 `comparePlugin` 未导出(SyntaxError: does not provide an export named)。

- [ ] **Step 3: 实现(追加到 check-updates.mjs 末尾)**

```js
// 比对单个插件。installed 为 installed_plugins.json 中数组首条记录,
// entry 为 marketplace.json 同名条目(缺失传 null)。
// 返回 { status: 'current' | 'update' | 'skip' | 'repo-check', ... }
// 'update' 携带 from/to;'repo-check' 携带 subPath,由调用方走 git diff(规则4)。
export function comparePlugin(installed, entry) {
  if (!entry || !installed) return { status: 'skip', reason: 'entry-missing' };
  const src = entry.source;
  // 形态 a:外部 url 源,条目带完整 sha → 与已装 gitCommitSha 全等比较
  if (src && typeof src === 'object') {
    if (typeof src.sha === 'string' && typeof installed.gitCommitSha === 'string' && installed.gitCommitSha) {
      return src.sha === installed.gitCommitSha
        ? { status: 'current' }
        : { status: 'update', from: installed.version, to: src.sha.slice(0, 12) };
    }
    return { status: 'skip', reason: 'url-no-sha' };
  }
  // 形态 b/c:仓库内置(source 为路径字符串)
  if (typeof src === 'string') {
    if (typeof entry.version === 'string' && typeof installed.version === 'string') {
      return entry.version === installed.version
        ? { status: 'current' }
        : { status: 'update', from: installed.version, to: entry.version };
    }
    return { status: 'repo-check', subPath: src };
  }
  return { status: 'skip', reason: 'undecidable' };
}
```

- [ ] **Step 4: 运行,确认通过**

```bash
node --test plugins/update-checker/tests/check-updates.test.mjs
```

预期:`pass 16`,`fail 0`。

- [ ] **Step 5: 提交**

```bash
git add plugins/update-checker/scripts/check-updates.mjs plugins/update-checker/tests/check-updates.test.mjs
git commit -m "feat: plugin comparison rules a/b/c (sha, version, repo-check marker)"
```

---

### Task 4: shortVer / splitKey / buildOutput 提醒输出(TDD)+ Task 3 审查收尾

**Files:**
- Modify: `plugins/update-checker/scripts/check-updates.mjs`(末尾追加 + comparePlugin 一处守护)
- Modify: `plugins/update-checker/tests/check-updates.test.mjs`(追加测试、替换 import)

- [ ] **Step 0(前置):Task 3 质量审查收尾(小修 + 测试锁定)**

按 TDD 顺序:先改测试看到红灯,再修实现。

1. 测试文件:把 `test('comparePlugin: 条目缺失 → skip', ...)` 整体替换为:

```js
test('comparePlugin: 条目缺失 → skip', () => {
  const r = comparePlugin({ version: '1.0.0', gitCommitSha: 'abc' }, null);
  assert.equal(r.status, 'skip');
  assert.equal(r.reason, 'entry-missing');
});
```

把 `test('comparePlugin: url 源但无 sha → skip', ...)` 整体替换为:

```js
test('comparePlugin: url 源但无 sha → skip', () => {
  const r = comparePlugin({ gitCommitSha: 'a' }, { name: 'x', source: { source: 'url', url: 'u' } });
  assert.equal(r.status, 'skip');
  assert.equal(r.reason, 'url-no-sha');
});
```

2. 测试文件末尾追加两个新测试:

```js
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
```

3. 运行 `node --test plugins/update-checker/tests/check-updates.test.mjs`,预期:`pass 17, fail 1`——唯一失败是"条目 sha 为空串"用例(当前实现会误判 update),这就是本步 TDD 红灯。

4. 修实现:`check-updates.mjs` 的 comparePlugin 中,把这一行:

```js
    if (typeof src.sha === 'string' && typeof installed.gitCommitSha === 'string' && installed.gitCommitSha) {
```

替换为:

```js
    if (typeof src.sha === 'string' && src.sha && typeof installed.gitCommitSha === 'string' && installed.gitCommitSha) {
```

5. 重跑测试,预期 `pass 18`,`fail 0`。提交:

```bash
git add plugins/update-checker/scripts/check-updates.mjs plugins/update-checker/tests/check-updates.test.mjs
git commit -m "fix: guard empty entry sha; test: lock skip reasons and undecidable branch"
```

- [ ] **Step 1: 追加失败的测试**

把 import 区中来自 `'../scripts/check-updates.mjs'` 的 import 语句替换为(其余 node 内置 import 保留不动):

```js
import {
  needsRefresh, recentFailure, readJsonSafe, TTL_MS,
  comparePlugin, shortVer, buildOutput,
} from '../scripts/check-updates.mjs';
```

文件末尾追加:

```js
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
```

- [ ] **Step 2: 运行,确认失败**

```bash
node --test plugins/update-checker/tests/check-updates.test.mjs
```

预期:FAIL(`shortVer` 未导出)。

- [ ] **Step 3: 实现(追加到 check-updates.mjs 末尾)**

```js
// 版本号显示:sha 形态(12-40 位 hex)截前 12 位,其余原样
export function shortVer(v) {
  if (typeof v !== 'string') return '?';
  return /^[0-9a-f]{12,40}$/i.test(v) ? v.slice(0, 12) : v;
}

// "name@marketplace" → [name, marketplace];无 @ 时 marketplace 为空串
export function splitKey(key) {
  const at = key.lastIndexOf('@');
  return at > 0 ? [key.slice(0, at), key.slice(at + 1)] : [key, ''];
}

// updates: [{ plugin, from, to }](from/to 已经过 shortVer)
// stale: [[marketplaceName, days]]  刷新失败且缓存过期的附注
export function buildOutput(updates, stale = []) {
  if (!Array.isArray(updates) || updates.length === 0) return null;
  const lines = updates.map((u) => {
    const [pname, mname] = splitKey(u.plugin);
    return `  • ${pname} ${u.from} → ${u.to} (${mname})`;
  });
  const cmds = updates.map((u) => `  claude plugin update ${u.plugin}`);
  let systemMessage =
    `🔄 ${updates.length} 个 Claude Code 插件有更新:\n` +
    lines.join('\n') + '\n' +
    '更新命令:\n' + cmds.join('\n') + '\n' +
    '更新后重启会话或运行 /reload-plugins 生效。';
  for (const [name, days] of stale) {
    systemMessage += `\n(注:${name} 版本信息已过期 ${days} 天,可能不准)`;
  }
  const additionalContext =
    `[update-checker] 有 ${updates.length} 个插件可更新:${updates.map((u) => u.plugin).join('、')}。` +
    '用户要求更新时,逐条执行 claude plugin update <name@marketplace>,' +
    '并提醒更新后需重启会话或运行 /reload-plugins。';
  return {
    systemMessage,
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
  };
}
```

- [ ] **Step 4: 运行,确认通过**

```bash
node --test plugins/update-checker/tests/check-updates.test.mjs
```

预期:`pass 21`,`fail 0`。

- [ ] **Step 5: 提交**

```bash
git add plugins/update-checker/scripts/check-updates.mjs plugins/update-checker/tests/check-updates.test.mjs
git commit -m "feat: reminder output builder (systemMessage + additionalContext)"
```

---

### Task 5: git 集成函数 refreshMarketplace / repoPluginChanged(TDD,真实临时 git 仓库)+ Task 4 审查收尾

**Files:**
- Modify: `plugins/update-checker/scripts/check-updates.mjs`(末尾追加 + shortVer 一处修改)
- Modify: `plugins/update-checker/tests/check-updates.test.mjs`(追加 helpers 与测试、替换 import)

- [ ] **Step 0(前置):Task 4 质量审查收尾(shortVer 守护 + splitKey 单测)**

1. 把测试文件 import 区中来自 `'../scripts/check-updates.mjs'` 的 import 语句替换为(加入 splitKey):

```js
import {
  needsRefresh, recentFailure, readJsonSafe, TTL_MS,
  comparePlugin, shortVer, splitKey, buildOutput,
} from '../scripts/check-updates.mjs';
```

2. 把现有 shortVer 测试整体替换为(新增空串与 64 位 hex 断言):

```js
test('shortVer: semver 原样;长 sha 截 12 位;12 位 sha 原样;非字符串/空串 → ?', () => {
  assert.equal(shortVer('5.1.0'), '5.1.0');
  assert.equal(shortVer('f2cbfbefebbfef77321e4c9abc9e949826bea9d7'), 'f2cbfbefebbf');
  assert.equal(shortVer('da20c92503b2'), 'da20c92503b2');
  assert.equal(shortVer(undefined), '?');
  assert.equal(shortVer(''), '?');
  assert.equal(shortVer('ab'.repeat(32)), 'abababababab');
});
```

3. 测试文件末尾追加 splitKey 直接单测:

```js
test('splitKey: 常规 key 拆分;无 @ / @ 开头 → marketplace 为空串', () => {
  assert.deepEqual(splitKey('superpowers@claude-plugins-official'), ['superpowers', 'claude-plugins-official']);
  assert.deepEqual(splitKey('noat'), ['noat', '']);
  assert.deepEqual(splitKey('@x'), ['@x', '']);
});
```

4. 运行 `node --test plugins/update-checker/tests/check-updates.test.mjs`,预期 `pass 21, fail 1`——唯一失败是 shortVer 用例(空串当前返回 `''`、64 位 hex 当前不截断);splitKey 新测试应直接通过。此即本步 TDD 红灯。

5. 修实现:`check-updates.mjs` 中 shortVer 函数整体替换为:

```js
// 版本号显示:sha 形态(12-64 位 hex)截前 12 位,其余原样
export function shortVer(v) {
  if (typeof v !== 'string' || !v) return '?';
  return /^[0-9a-f]{12,64}$/i.test(v) ? v.slice(0, 12) : v;
}
```

6. 重跑测试,预期 `pass 22`,`fail 0`。提交:

```bash
git add plugins/update-checker/scripts/check-updates.mjs plugins/update-checker/tests/check-updates.test.mjs
git commit -m "fix: shortVer empty-string guard and sha-256 length; test: splitKey coverage"
```

- [ ] **Step 1: 追加失败的测试**

import 语句块替换为:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  needsRefresh, recentFailure, readJsonSafe, TTL_MS,
  comparePlugin, shortVer, splitKey, buildOutput,
  repoPluginChanged, refreshMarketplace,
} from '../scripts/check-updates.mjs';
```

注意:上面的替换会把原文件第一、二行(`import { test } ...` 和 `import assert ...`)一并覆盖,即 import 区整体换成上面这一块;其余已有测试保持不动。

在 import 区之后、第一个 test 之前插入公共 helpers:

```js
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
```

文件末尾追加:

```js
test('repoPluginChanged: 子目录未动 → false;动过 → true;坏 sha/空 sha → null', () => {
  const repo = makeRepo();
  mkdirSync(join(repo, 'plugins', 'foo'), { recursive: true });
  mkdirSync(join(repo, 'other'), { recursive: true });
  writeFileSync(join(repo, 'plugins', 'foo', 'a.txt'), '1');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'c1');
  const sha = git(repo, 'rev-parse', 'HEAD').trim();

  // 只改插件目录之外的文件 → 该插件无变化
  writeFileSync(join(repo, 'other', 'b.txt'), '2');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'c2');
  assert.equal(repoPluginChanged(repo, sha, 'plugins/foo'), false);

  // 改插件目录内文件 → 有变化
  writeFileSync(join(repo, 'plugins', 'foo', 'a.txt'), '99');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'c3');
  assert.equal(repoPluginChanged(repo, sha, 'plugins/foo'), true);

  // sha 不在历史中 / 为空 → 无法判定 null
  assert.equal(repoPluginChanged(repo, 'deadbeef'.repeat(5), 'plugins/foo'), null);
  assert.equal(repoPluginChanged(repo, '', 'plugins/foo'), null);
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
```

- [ ] **Step 2: 运行,确认失败**

```bash
node --test plugins/update-checker/tests/check-updates.test.mjs
```

预期:FAIL(`repoPluginChanged` 未导出)。

- [ ] **Step 3: 实现(追加到 check-updates.mjs 末尾)**

同时在文件顶部 import 区追加一行:

```js
import { execFileSync } from 'node:child_process';
```

追加函数:

```js
export const PULL_TIMEOUT_MS = 8 * 1000; // 单仓库 git pull 超时

// 对 marketplace 缓存仓库做 git pull --ff-only;任何失败(离线、非快进、非仓库)→ false
export function refreshMarketplace(repoDir, timeoutMs = PULL_TIMEOUT_MS) {
  try {
    execFileSync('git', ['-C', repoDir, 'pull', '--ff-only'], { timeout: timeoutMs, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// 规则4:仓库内置且条目无 version 时,看插件子目录自已装 sha 以来是否有变更
// 返回 true(有变更)/ false(无变更)/ null(无法判定:sha 缺失或不在历史中)
// 纯本地 git 操作,不产生网络流量
export function repoPluginChanged(repoDir, sha, subPath) {
  if (typeof sha !== 'string' || !sha) return null;
  try {
    execFileSync('git', ['-C', repoDir, 'diff', '--quiet', sha, 'HEAD', '--', subPath],
      { timeout: PULL_TIMEOUT_MS, stdio: 'ignore' });
    return false; // exit 0 = 无差异
  } catch (err) {
    if (err && err.status === 1) return true; // exit 1 = 有差异
    return null;                              // exit 128 等 = 坏 sha / git 失败
  }
}
```

- [ ] **Step 4: 运行,确认通过**

```bash
node --test plugins/update-checker/tests/check-updates.test.mjs
```

预期:`pass 24`,`fail 0`。

- [ ] **Step 5: 提交**

```bash
git add plugins/update-checker/scripts/check-updates.mjs plugins/update-checker/tests/check-updates.test.mjs
git commit -m "feat: git integration - throttled pull and per-plugin diff detection"
```

---

### Task 6: run() 编排 + hook 入口 + 端到端集成测试(TDD)+ Task 5 审查收尾

**Files:**
- Modify: `plugins/update-checker/scripts/check-updates.mjs`(末尾追加 + 顶部 import 扩充 + git 函数加固)
- Create: `plugins/update-checker/scripts/hook-entry.mjs`
- Modify: `plugins/update-checker/tests/check-updates.test.mjs`(追加测试、替换 import)

- [ ] **Step 0(前置):Task 5 质量审查收尾(非交互 git env + sha 预校验 + diff 超时参数)**

TDD 顺序:先改测试看红灯,再修实现。

1. 测试文件:把 repoPluginChanged 集成测试整体替换为(钉住生产 `./` 前缀形态 + 非 hex sha 预校验断言):

```js
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
```

2. 运行 `node --test plugins/update-checker/tests/check-updates.test.mjs`,预期 `pass 23, fail 1`——唯一失败是 repoPluginChanged 用例:`--output=x` 会被当前实现传给 git 当选项解析,返回 false 而非 null。此即红灯。

3. 修实现:`check-updates.mjs` 中把 refreshMarketplace 与 repoPluginChanged 两个函数(连同各自注释)整体替换为(PULL_TIMEOUT_MS 常量保持不动):

```js
// 强制非交互的 git 环境:禁止凭据/ssh 交互提示(含 Windows GCM GUI 弹窗),
// 避免会话启动时弹窗或挂起。必须展开 process.env,否则 Windows 下 git 缺 PATH 会 spawn 失败。
const GIT_NONINTERACTIVE_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
  GIT_SSH_COMMAND: 'ssh -oBatchMode=yes',
};

// 对 marketplace 缓存仓库做 git pull --ff-only;任何失败(离线、非快进、非仓库)→ false
export function refreshMarketplace(repoDir, timeoutMs = PULL_TIMEOUT_MS) {
  try {
    execFileSync('git', ['-C', repoDir, 'pull', '--ff-only'],
      { timeout: timeoutMs, stdio: 'ignore', env: GIT_NONINTERACTIVE_ENV });
    return true;
  } catch {
    return false;
  }
}

// 规则4:仓库内置且条目无 version 时,看插件子目录自已装 sha 以来是否有变更
// 返回 true(有变更)/ false(无变更)/ null(无法判定:sha 缺失、非法或不在历史中)
// 纯本地 git 操作,不产生网络流量;sha 先做 hex 预校验,杜绝被解析为 git 选项
export function repoPluginChanged(repoDir, sha, subPath, timeoutMs = PULL_TIMEOUT_MS) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{4,64}$/i.test(sha)) return null;
  try {
    execFileSync('git', ['-C', repoDir, 'diff', '--quiet', sha, 'HEAD', '--', subPath],
      { timeout: timeoutMs, stdio: 'ignore' });
    return false; // exit 0 = 无差异
  } catch (err) {
    if (err && err.status === 1) return true; // exit 1 = 有差异
    return null;                              // exit 128 等 = 坏 sha / git 失败
  }
}
```

4. 重跑测试,预期 `pass 24`,`fail 0`。提交:

```bash
git add plugins/update-checker/scripts/check-updates.mjs plugins/update-checker/tests/check-updates.test.mjs
git commit -m "fix: non-interactive git env, sha pre-validation, diff timeout param; test: production pathspec form"
```

- [ ] **Step 1: 追加失败的端到端测试**

import 语句块中,从 `'../scripts/check-updates.mjs'` 的导入增加 `run`:

```js
import {
  needsRefresh, recentFailure, readJsonSafe, TTL_MS,
  comparePlugin, shortVer, splitKey, buildOutput,
  repoPluginChanged, refreshMarketplace,
  run,
} from '../scripts/check-updates.mjs';
```

在 helpers 区(makeRepo 之后)追加:

```js
function withConfigDir(cfg, fn) {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
  }
}
```

文件末尾追加:

```js
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
```

- [ ] **Step 2: 运行,确认失败**

```bash
node --test plugins/update-checker/tests/check-updates.test.mjs
```

预期:FAIL(`run` 未导出)。

- [ ] **Step 3: 实现 run()(追加到 check-updates.mjs 末尾)**

先把文件顶部的 fs import 行:

```js
import { readFileSync } from 'node:fs';
```

替换为:

```js
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
```

再追加:

```js
export const STALE_NOTE_MS = 48 * 60 * 60 * 1000; // 缓存超过 48h 未刷新成功 → 提醒附注
export const TOTAL_BUDGET_MS = 10 * 1000;          // 全脚本时间预算
const DAY_MS = 24 * 60 * 60 * 1000;

export function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

export function stateDirFor(cfg) {
  return join(cfg, 'plugins', 'data', 'update-checker');
}

// 仅 UPDATE_CHECKER_DEBUG=1 时写日志文件;绝不写 stderr
export function debug(cfg, ...args) {
  if (process.env.UPDATE_CHECKER_DEBUG !== '1') return;
  try {
    const dir = stateDirFor(cfg);
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'debug.log'), `${new Date().toISOString()} ${args.join(' ')}\n`);
  } catch { /* 调试路径不冒泡任何错误 */ }
}

// 主编排:发现 → 节流刷新 → 比对 → 输出。失败一律静默降级,返回 null 表示无需提醒。
export function run(now = Date.now()) {
  const cfg = configDir();
  const pluginsDir = join(cfg, 'plugins');
  const installed = readJsonSafe(join(pluginsDir, 'installed_plugins.json'));
  const known = readJsonSafe(join(pluginsDir, 'known_marketplaces.json'));
  if (!installed?.plugins || !known) { debug(cfg, 'missing state files'); return null; }
  const pluginEntries = Object.entries(installed.plugins);
  if (pluginEntries.length === 0) return null;

  const statePath = join(stateDirFor(cfg), 'state.json');
  const state = readJsonSafe(statePath) || {};
  state.lastRefresh = state.lastRefresh || {};
  state.lastFailure = state.lastFailure || {};

  const budgetEnd = now + TOTAL_BUDGET_MS;
  const manifests = new Map(); // marketplace 名 → { dir, byName: Map(插件名→条目) }
  const stale = [];            // [marketplace 名, 过期天数]

  for (const [name, mkt] of Object.entries(known)) {
    const dir = mkt?.installLocation;
    if (!dir || !existsSync(join(dir, '.git'))) { debug(cfg, 'skip non-git marketplace', name); continue; }

    if (needsRefresh(state, name, now) && !recentFailure(state, name, now)) {
      const remaining = budgetEnd - Date.now();
      if (remaining > 500) {
        debug(cfg, 'refreshing', name);
        if (refreshMarketplace(dir, Math.min(PULL_TIMEOUT_MS, remaining))) {
          state.lastRefresh[name] = new Date().toISOString();
          delete state.lastFailure[name];
        } else {
          state.lastFailure[name] = new Date().toISOString();
          debug(cfg, 'refresh failed', name);
        }
      }
    }

    const manifest = readJsonSafe(join(dir, '.claude-plugin', 'marketplace.json'));
    if (!Array.isArray(manifest?.plugins)) { debug(cfg, 'no manifest', name); continue; }
    manifests.set(name, {
      dir,
      byName: new Map(manifest.plugins.filter((p) => p && p.name).map((p) => [p.name, p])),
    });

    const lastT = Date.parse(state.lastRefresh[name] ?? mkt?.lastUpdated ?? '');
    if (!Number.isNaN(lastT) && now - lastT > STALE_NOTE_MS) {
      stale.push([name, Math.max(1, Math.floor((now - lastT) / DAY_MS))]);
    }
  }

  const updates = [];
  for (const [key, records] of pluginEntries) {
    const rec = Array.isArray(records) ? records[0] : records; // 多 scope 取首条
    const [pname, mname] = splitKey(key);
    const mkt = manifests.get(mname);
    if (!rec || !mkt) continue;
    let cmp = comparePlugin(rec, mkt.byName.get(pname) ?? null);
    if (cmp.status === 'repo-check') {
      // 规则4:本地 git diff 判定插件子目录是否有变更;同样受总预算约束,预算不足视为无法判定
      const remaining = budgetEnd - Date.now();
      const changed = remaining > 500
        ? repoPluginChanged(mkt.dir, rec.gitCommitSha, cmp.subPath, Math.min(PULL_TIMEOUT_MS, remaining))
        : null;
      cmp = changed === true
        ? { status: 'update', from: rec.version, to: '内容有更新' }
        : changed === false
          ? { status: 'current' }
          : { status: 'skip', reason: 'undecidable' };
    }
    if (cmp.status === 'update') {
      updates.push({ plugin: key, from: shortVer(cmp.from ?? rec.version), to: shortVer(cmp.to) });
    }
  }

  try {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch { debug(cfg, 'state write failed'); }

  debug(cfg, 'updates found:', String(updates.length));
  return buildOutput(updates, stale);
}
```

- [ ] **Step 4: 创建 `plugins/update-checker/scripts/hook-entry.mjs`(完整内容)**

```js
#!/usr/bin/env node
// SessionStart hook 入口:任何异常静默降级,永远 exit 0,绝不阻塞会话启动。
import { run, configDir, debug } from './check-updates.mjs';

let out = null;
try {
  out = run();
} catch (err) {
  try { debug(configDir(), 'fatal', err && err.stack ? err.stack : String(err)); } catch { /* 忽略 */ }
}
if (out) {
  try { process.stdout.write(JSON.stringify(out)); } catch { /* 忽略 */ }
}
process.exit(0);
```

- [ ] **Step 5: 运行全部测试,确认通过**

```bash
node --test plugins/update-checker/tests/check-updates.test.mjs
```

预期:`pass 26`,`fail 0`。

- [ ] **Step 6: 冒烟 — 直接以 hook 方式在真实环境跑一次入口**

```bash
node plugins/update-checker/scripts/hook-entry.mjs; echo "exit=$?"
```

预期:`exit=0`;stdout 为一段 JSON(本机插件确实过期,应有 systemMessage)或空(若全部最新)。绝不出现堆栈/stderr 噪音。

- [ ] **Step 7: 提交**

```bash
git add plugins/update-checker/scripts/check-updates.mjs plugins/update-checker/scripts/hook-entry.mjs plugins/update-checker/tests/check-updates.test.mjs
git commit -m "feat: run() orchestration with budgeted refresh and hook entry"
```

---

### Task 7: 本机 dogfood(手动验证矩阵,对应 spec §12)

**Files:** 无新文件;验证性质。若发现 bug,回到对应 Task 的代码修复并补测试。

- [ ] **Step 1: 以本地目录为 marketplace 安装产品**

在 Claude Code 会话中执行:

```
/plugin marketplace add d:\zhuocheng\test\pull_all_the_time
/plugin install update-checker@plugin-update-checker
```

预期:安装成功;`C:\Users\yangzhuocheng\.claude\plugins\installed_plugins.json` 出现 `update-checker@plugin-update-checker` 条目(可用 Read 工具核对)。

注意:本地路径安装后,后续改代码需执行 `/plugin marketplace update plugin-update-checker` 重新同步才生效。

- [ ] **Step 2: 新开会话,验证提醒出现(VSCode 面板)**

关闭当前会话,新开一个 VSCode 面板会话。

预期:会话开始时出现 systemMessage 提醒,列出过期插件(本机 superpowers/skill-creator/document-skills/karpathy-skills 已 5 个月未更新,大概率命中)。

若未出现:在系统环境变量或 settings.json 的 env 中加 `UPDATE_CHECKER_DEBUG=1`,再新开会话,然后读 `C:\Users\yangzhuocheng\.claude\plugins\data\update-checker\debug.log` 定位;常见原因是 hook 未触发(检查 `/plugin` 里插件是否启用)或 node 不在 PATH。

- [ ] **Step 3: 确定性验证(不依赖上游真的有新版本)**

若 Step 2 没有出现提醒(比如上游恰好无变化),手工制造一个"过期":用编辑器把 `installed_plugins.json` 中 superpowers 的 `version` 改成 `5.0.9`、`gitCommitSha` 改成 40 个 `0`,保存后新开会话。

预期:提醒中出现 superpowers。验证完把两处值改回原样(`5.1.0` / `f2cbfbefebbfef77321e4c9abc9e949826bea9d7`)。

- [ ] **Step 4: 一键更新链路**

复制提醒中的命令在终端执行(任选一个真实有更新的插件):

```bash
claude plugin update <name@marketplace>
```

预期:命令成功;重启会话或 `/reload-plugins` 后,该插件不再出现在提醒里。

再测会话内自然语言链路:新开会话说"帮我更新插件"。

预期:Claude 依据 additionalContext 直接执行正确的 `claude plugin update` 命令。

- [ ] **Step 5: 无更新 → 静默**

把所有插件更新到最新后新开会话。

预期:无任何提醒输出,会话启动无感知延迟。

- [ ] **Step 6: 离线降级**

断开网络(或临时把某 marketplace 缓存仓库的 remote 改成不可达地址:`git -C <installLocation> remote set-url origin https://invalid.example/x.git`),新开会话。

预期:会话正常启动不阻塞(最长约 10s 预算内);无报错;缓存过期超 48h 时提醒带"(注:...已过期 N 天)"附注。测完恢复 remote 原值(`git -C <installLocation> remote get-url origin` 先记录原值)。

- [ ] **Step 7: 记录结果**

在 spec §12 的 dogfood 矩阵旁记录实测结果(通过/失败+现象)。有失败项 → 修复代码、补回归测试、回到本 Task 重跑。

---

### Task 8: README 改写 + 发布准备

**Files:**
- Rename+Rewrite: `readme.md` → `README.md`
- Modify: `.gitignore`(无变化则跳过)

- [ ] **Step 1: 重命名(大小写翻转,Windows 下用 git mv)**

```bash
git mv readme.md README.md
```

若报大小写冲突,用两步中转:

```bash
git mv readme.md README.tmp.md && git mv README.tmp.md README.md
```

- [ ] **Step 2: 写入 README.md 完整内容**

````markdown
# plugin-update-checker

A Claude Code plugin that reminds you, at every session start, when any of your
installed Claude Code plugins has an update available — across **all** your
marketplaces, including third-party ones. Works in the CLI and in the VSCode
extension panel.

## Why

Claude Code's built-in plugin auto-update only runs on the interactive CLI
startup path, is disabled by `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, and
skips third-party marketplaces by default. If you mainly use the VSCode panel,
your plugins can silently age for months. This plugin closes that gap — with
reminders, never silent auto-updates.

## Install

```
/plugin marketplace add <owner>/plugin-update-checker
/plugin install update-checker@plugin-update-checker
```

## What you get

- A reminder at session start listing outdated plugins with the exact
  `claude plugin update ...` commands.
- Or just tell Claude "update my plugins" in the session — the reminder is also
  injected as context, so Claude knows what to run.
- Checks are throttled: marketplace git repos are refreshed at most once per
  24h; version comparison itself is local and instant.

## Privacy

- Reads only your local `~/.claude/plugins/` state files.
- Network traffic goes solely to the git remotes of marketplaces you already
  registered, at most once per 24h. Never contacts Anthropic. No telemetry.

## 中文简介

装上它,每次启动 Claude Code 会话(CLI 或 VSCode 面板)时,自动检查所有已安装
插件(含第三方 marketplace)是否有新版本:提醒并给出可直接执行的更新命令,也
可以直接在会话里说一句"帮我更新插件"让 Claude 代跑。每 24h 至多刷新一次
marketplace 仓库;只读取本机文件,不访问 Anthropic 端点,无任何遥测。

## Development

- Design spec: `docs/superpowers/specs/2026-11-13-plugin-update-checker-design.md`
- Tests: `node --test plugins/update-checker/tests/check-updates.test.mjs`
- Debug: set `UPDATE_CHECKER_DEBUG=1`, logs go to
  `~/.claude/plugins/data/update-checker/debug.log`

## License

MIT
````

- [ ] **Step 3: 验证并提交**

```bash
ls README.md readme.md 2>/dev/null
git add -A
git commit -m "docs: product README (EN + 中文), rename from readme.md"
```

预期:`ls` 只列出 `README.md`(readme.md 已不存在,Windows 大小写不敏感故只显示一个)。

- [ ] **Step 4: 发布到 GitHub(需要用户参与)**

**此步骤执行前,向用户询问 GitHub 用户名与仓库名**(默认建议仓库名 `plugin-update-checker`)。用户需先在 GitHub 上创建空仓库(不要初始化 README),然后:

```bash
git remote add origin https://github.com/<用户提供的用户名>/plugin-update-checker.git
git tag v0.1.0
git push -u origin main
git push origin v0.1.0
```

预期:推送成功。之后用户可把 README 安装命令中的 `<owner>` 替换为真实用户名(改完再提交推送一次)。

- [ ] **Step 5: 发布后端到端复验**

在**另一台机器**(或删掉本地安装的干净环境)执行 README 里的两条安装命令,新开会话确认提醒链路工作。这是"产品在其他机器可复用"的最终验收。

---

## Self-Review 记录(计划作者已执行)

1. **Spec 覆盖**:§4 仓库结构→Task 1/6/8;§5 运行流程→Task 6;§6 比对规则(含形态 c git diff)→Task 3/5/6;§7 时间预算与静默降级→Task 5/6;§8 输出契约与过期附注→Task 4/6;§9 状态文件→Task 6;§10 决策(ff-only、data 目录、跨平台命令)→Task 1/5/6;§12 测试→Task 2-7;§14 README→Task 8;§11 隐私声明→Task 8 README。无缺口。
2. **占位符扫描**:仅 `<owner>`/`<用户提供的用户名>`,为发布时用户输入,已标注询问时机;无 TBD/TODO。
3. **类型一致性**:`refreshMarketplace(repoDir, timeoutMs?)`、`repoPluginChanged(repoDir, sha, subPath)`、`comparePlugin(installed, entry)`、`buildOutput(updates, stale?)`、`splitKey(key)`、`shortVer(v)`、`needsRefresh(state, name, now, ttl?)`、`recentFailure(state, name, now)`、`run(now?)`、`configDir()`、`stateDirFor(cfg)`、`debug(cfg, ...args)` — 定义与全部调用点已核对一致;测试 import 列表逐任务递增核对无误。
