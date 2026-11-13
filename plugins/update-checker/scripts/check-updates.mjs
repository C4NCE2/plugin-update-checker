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
