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
