# Public repository maintenance - 2026-10-09

Scope: SHOGO391 public repositories only. Private repositories and live business services are outside this change.

Implemented: owner-only POSIX directories/files for current and older databases, originals, backup, restore and handoff export; symlink rejection; dependency update; MIT and reporting guidance included in Mac distribution.

Validation: npm run check (34 tests passed with synthetic data). Start: npm ci --ignore-scripts; npm run dev, or Start-Mac.command.

Mac distribution: extracted ZIP, pinned Node 24.21.0 download/checksum, production dependencies, doctor and localhost startup passed on macOS arm64. Dependency audit: 0 vulnerabilities.

Next: independent review and publication. Real TKC access and Windows ACL isolation remain unverified.

<!-- harness:start -->
## Harness

- Task: 008b3e3d6455 / Protect public preview local financial data
- 状態: done
- 次の作業: 完了。変更が生じた場合は再検証する
- 試行: 0/3
- 記録: .harness/008b3e3d6455/task.json
<!-- harness:end -->
