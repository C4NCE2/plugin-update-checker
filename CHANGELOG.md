# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semver.

## [0.1.4] - 2026-11-18

### Added
- On-demand read-only status report (`node scripts/status.mjs`): per-plugin installed → latest, trust tiers (official / organization / personal) and state (update / current / ignored / no cached manifest / undecidable), stale-cache notes and ignore config. Zero network, no refresh, no writes; always exits 0.
- Status command embedded in reminders (systemMessage and additionalContext), so the report is reachable from the VSCode panel.
- `evaluatePlugins` / `staleNotes` / `loadManifestsCached` extraction shared by the hook and the status report (single source of comparison truth).

## [0.1.3] - 2026-11-16

### Added
- Provenance line in reminders: each mentioned marketplace's source repo is shown at the point of the update nudge.
- CHANGELOG, issue/PR templates, tag-triggered automatic GitHub Releases.
- README: hard facts up front; "Sources & trust" section (source compatibility, deliberate private-auth limitation, offline behavior, supply-chain trust model).

## [0.1.2] - 2026-11-16

### Fixed
- Merge-only marketplace changes no longer missed by recency detection (`--diff-merges=first-parent --no-patch`).
- Non-ASCII paths safe (`core.quotePath=false`).

### Added
- Stale-cache notes name failed refreshes (zh/en).
- Optional ignore config `~/.claude/update-checker.json`.
- Marketplace entry version + parity test; homepage/repository metadata.
- zh/en structural parity test; read-only comparison guard e2e.
- Scheduled self-dogfood workflow + hook fixture integration tests.

## [0.1.1] - 2026-11-16

### Added
- Bilingual reminders (zh/en): OS locale auto-detect, `UPDATE_CHECKER_LANG` override.

## [0.1.0] - 2026-11-16

### Added
- Initial release: session-start update reminders for all installed Claude Code plugins across all marketplaces; CLI + VSCode panel (model relay); throttled refresh; false-positive resistance (recency + on-disk manifest); zero deps, zero LLM, never blocks.
