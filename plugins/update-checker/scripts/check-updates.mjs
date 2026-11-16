// check-updates.mjs — plugin-update-checker 核心逻辑。
// 纯模块:导出函数,不主动执行;hook 入口见 hook-entry.mjs。
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const TTL_MS = 24 * 60 * 60 * 1000;     // marketplace 刷新节流间隔(24h)
export const FAILURE_RETRY_MS = 60 * 60 * 1000; // 刷新失败后的重试间隔(1h)

export function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// 只接受 plain object;标量/数组/null 一律视为空对象(防损坏 state 引发属性赋值 TypeError)
export function asObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

// 已装插件的真实版本:读安装目录 .claude-plugin/plugin.json;缺失/非法 → null(回退记录字段)
export function installedVersion(installPath) {
  if (typeof installPath !== 'string' || !installPath) return null;
  const m = readJsonSafe(join(installPath, '.claude-plugin', 'plugin.json'));
  return m && typeof m.version === 'string' && m.version ? m.version : null;
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

// 比对单个插件。installed 为 installed_plugins.json 中数组首条记录,
// entry 为 marketplace.json 同名条目(缺失传 null)。
// 返回 { status: 'current' | 'update' | 'skip' | 'repo-check', ... }
// 'update' 携带 from/to;'repo-check' 携带 subPath,由调用方走 git diff(规则4)。
export function comparePlugin(installed, entry) {
  if (!entry || !installed) return { status: 'skip', reason: 'entry-missing' };
  const src = entry.source;
  // 形态 a:外部 url 源,条目带完整 sha → 与已装 gitCommitSha 全等比较
  if (src && typeof src === 'object') {
    if (typeof src.sha === 'string' && src.sha && typeof installed.gitCommitSha === 'string' && installed.gitCommitSha) {
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

// 版本号显示:sha 形态(12-64 位 hex)截前 12 位,其余原样
export function shortVer(v) {
  if (typeof v !== 'string' || !v) return '?';
  return /^[0-9a-f]{12,64}$/i.test(v) ? v.slice(0, 12) : v;
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
  let body =
    `🔄 ${updates.length} 个 Claude Code 插件有更新:\n` +
    lines.join('\n') + '\n' +
    '更新命令:\n' + cmds.join('\n') + '\n' +
    '更新后重启会话或运行 /reload-plugins 生效。';
  for (const [name, days] of stale) {
    body += `\n(注:${name} 版本信息已过期 ${days} 天,可能不准)`;
  }
  // VSCode 面板不渲染 systemMessage(2.1.325 实证),additionalContext 承担跨环境可见性:
  // 指示模型在首条回复开头原样转达提醒,再照常回应;用户要求更新时逐条执行命令。
  const additionalContext =
    '[update-checker] 插件更新提醒。请在本次回复的开头先向用户转达以下提醒(原样列出插件与命令,不要省略),然后照常回应用户:\n' +
    body + '\n' +
    '用户要求更新时,逐条执行上述 claude plugin update 命令。';
  return {
    systemMessage: body,
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
  };
}

export const PULL_TIMEOUT_MS = 8 * 1000; // 单仓库 git pull 超时

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

// 目标引入时间(纯本地 git 历史):
// 形态 a 传 ['-S<sha>', '--', '.claude-plugin/marketplace.json'](pickaxe 查 pin 写入清单的提交日期)
// 形态 c 传 ['--', subPath](插件子目录最后变更日期)
// 查不到/失败 → null
export function targetDate(repoDir, args, timeoutMs = PULL_TIMEOUT_MS) {
  try {
    const out = execFileSync('git', ['-C', repoDir, 'log', '-1', '--format=%cI', ...args],
      { timeout: timeoutMs, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    return out || null;
  } catch {
    return null;
  }
}

// 更新新近性:已装记录的更新时间晚于目标引入时间 → 已跟上;时间戳无效 → false(保守提醒)
export function isCaughtUp(recLastUpdated, targetIso) {
  const a = Date.parse(recLastUpdated ?? '');
  const b = Date.parse(targetIso ?? '');
  return !Number.isNaN(a) && !Number.isNaN(b) && a > b;
}

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
    appendFileSync(join(dir, 'debug.log'), `${new Date().toISOString()} ${args.map((a) => String(a).replace(/[\r\n]+/g, ' ')).join(' ')}\n`);
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
  const rawState = readJsonSafe(statePath);
  const state = rawState && typeof rawState === 'object' ? rawState : {};
  state.lastRefresh = asObject(state.lastRefresh);
  state.lastFailure = asObject(state.lastFailure);

  const budgetEnd = Date.now() + TOTAL_BUDGET_MS; // 预算锚定实时钟;注入的 now 仅用于业务判定
  const manifests = new Map(); // marketplace 名 → { dir, byName: Map(插件名→条目) }
  const stale = [];            // [marketplace 名, 过期天数]

  for (const [name, mkt] of Object.entries(known)) {
    const dir = mkt?.installLocation;
    if (typeof dir !== 'string' || !dir || !existsSync(join(dir, '.git'))) { debug(cfg, 'skip non-git marketplace', name); continue; }

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

    let lastT = Date.parse(state.lastRefresh[name] ?? '');
    if (Number.isNaN(lastT)) lastT = Date.parse(mkt?.lastUpdated ?? '');
    if (!Number.isNaN(lastT) && now - lastT > STALE_NOTE_MS) {
      stale.push([name, Math.max(1, Math.floor((now - lastT) / DAY_MS))]);
    }
  }

  const updates = [];
  for (const [key, records] of pluginEntries) {
    const rec0 = Array.isArray(records) ? records[0] : records; // 多 scope 取首条
    const [pname, mname] = splitKey(key);
    const mkt = manifests.get(mname);
    if (!rec0 || !mkt) continue;
    // 已装版本以安装目录 plugin.json 为准(记录字段可能与实际文件 diverge);读不到回退记录
    const disk = installedVersion(rec0.installPath);
    const rec = disk ? { ...rec0, version: disk } : rec0;
    const entry = mkt.byName.get(pname) ?? null;
    let cmp = comparePlugin(rec, entry);
    if (cmp.status === 'repo-check') {
      // 规则4:本地 git diff 判定插件子目录是否有变更;同样受总预算约束,预算不足视为无法判定
      const subPath = cmp.subPath;
      const remaining = budgetEnd - Date.now();
      const changed = remaining > 500
        ? repoPluginChanged(mkt.dir, rec.gitCommitSha, subPath, Math.min(PULL_TIMEOUT_MS, remaining))
        : null;
      cmp = changed === true
        ? { status: 'update', from: rec.version, to: '内容有更新' }
        : changed === false
          ? { status: 'current' }
          : { status: 'skip', reason: 'undecidable' };
      if (cmp.status === 'update') {
        // 形态 c"已跟上":更新时间晚于子目录最后变更时间(兼容不回写 sha 的 Claude 版本)
        const rem = budgetEnd - Date.now();
        const d = rem > 500 ? targetDate(mkt.dir, ['--', subPath], Math.min(PULL_TIMEOUT_MS, rem)) : null;
        if (isCaughtUp(rec.lastUpdated, d)) cmp = { status: 'current' };
      }
    } else if (cmp.status === 'update' && entry && entry.source && typeof entry.source === 'object'
               && typeof entry.source.sha === 'string' && entry.source.sha) {
      // 形态 a"已跟上":更新时间晚于 pin sha 写入清单的提交日期(兼容不回写 sha 的 Claude 版本)
      const rem = budgetEnd - Date.now();
      const d = rem > 500
        ? targetDate(mkt.dir, [`-S${entry.source.sha}`, '--', '.claude-plugin/marketplace.json'], Math.min(PULL_TIMEOUT_MS, rem))
        : null;
      if (isCaughtUp(rec.lastUpdated, d)) cmp = { status: 'current' };
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
