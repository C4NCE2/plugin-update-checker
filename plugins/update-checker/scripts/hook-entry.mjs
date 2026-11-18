#!/usr/bin/env node
// SessionStart hook 入口:任何异常静默降级,永远 exit 0,绝不阻塞会话启动。
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, configDir, debug } from './check-updates.mjs';

// 以自身路径推算 status.mjs 绝对路径,提醒里附上可直接执行的状态查询命令(面板可达)
const statusCmd = `node "${join(dirname(fileURLToPath(import.meta.url)), 'status.mjs')}"`;

let out = null;
try {
  out = run(undefined, undefined, statusCmd);
} catch (err) {
  try { debug(configDir(), 'fatal', err && err.stack ? err.stack : String(err)); } catch { /* 忽略 */ }
}
if (out) {
  try { process.stdout.write(JSON.stringify(out)); } catch { /* 忽略 */ }
}
process.exitCode = 0; // 自然退出保证 stdout flush;exit code 恒 0
