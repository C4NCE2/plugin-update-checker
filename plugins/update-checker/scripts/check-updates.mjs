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
