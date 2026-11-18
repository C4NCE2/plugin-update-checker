#!/usr/bin/env node
// 只读状态报告:零网络、不刷新、不写盘;恒 exit 0。
import { join } from 'node:path';
import {
  configDir, readJsonSafe, loadIgnore, loadManifestsCached,
  evaluatePlugins, staleNotes, buildStatus,
} from './check-updates.mjs';

let out = '';
try {
  const cfg = configDir();
  const pluginsDir = join(cfg, 'plugins');
  const installed = readJsonSafe(join(pluginsDir, 'installed_plugins.json'));
  const known = readJsonSafe(join(pluginsDir, 'known_marketplaces.json')) || {};
  const state = readJsonSafe(join(pluginsDir, 'data', 'update-checker', 'state.json')) || {};
  const ignore = loadIgnore(cfg);
  const manifests = loadManifestsCached(known, true);
  const entries = Object.entries(installed?.plugins || {});
  const { results } = evaluatePlugins(entries, manifests, known, state, ignore);
  out = buildStatus(results, staleNotes(known, state, Date.now(), manifests), ignore);
} catch { out = ''; }
if (out) process.stdout.write(out + '\n');
process.exitCode = 0;
