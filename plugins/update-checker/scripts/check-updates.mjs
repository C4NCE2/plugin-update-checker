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
