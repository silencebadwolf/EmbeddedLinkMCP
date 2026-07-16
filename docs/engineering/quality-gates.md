# Engineering Quality Gates

`pnpm run ci:check` is the local aggregate for lint, the authoritative production build, the complete automated test suite, and license validation. CI tests the Node.js 22 line at its supported floor, 22.13.0, with pnpm 9.15.0; the root engine contract is `^22.13.0 || >=24.0.0` so it does not claim unsupported Node.js 23 compatibility. CI then performs a fresh platform-local `pnpm install --frozen-lockfile` on Windows, Ubuntu, and macOS before running the gates. Third-party Actions are pinned to reviewed full commit SHAs, repository permissions are read-only, and checkout credentials are not persisted.

`pnpm run test:coverage` runs the WSL/native dependency doctor and the complete Vitest suite with V8 coverage. Reports are written to `coverage/` as text, JSON summary, HTML, and LCOV. Phase 0 publishes an honest whole-source baseline and defines no numeric threshold.

`pnpm run validate:licenses` keeps the 19 product runtime records separate from coverage tooling. It also resolves and verifies the exact 29-package production-dependency closure rooted at `@vitest/coverage-v8@4.1.8`, including repository license files; peer dependencies, package development dependencies, and uninstalled optional peers are outside that narrowly stated audit.

The CI matrix is core automation, not install-level hardware acceptance. Windows remains the first manual UI/hardware acceptance platform. macOS and Linux must keep types, build, tests, licenses, and hardware-free core logic compatible.

CI tests use mocks, fakes, or null backends. They must never open a real serial port, attach a probe, erase or program flash, reset a target, start a real GDB server, or connect RTT.

Native packages are installed separately on each operating system. Do not cache or copy `node_modules` between platforms. On Linux/WSL, `scripts/doctor-wsl.mjs` reports missing Rolldown/Tailwind native bindings and preserves the existing remediation guidance.

## Phase 0 local coverage baseline

Fresh baseline captured on 2026-07-12 from Windows with Node.js 24.12.0, pnpm 9.15.0, Vitest 4.1.8, and `@vitest/coverage-v8` 4.1.8:

| Metric     | Covered / total | Percent |
| ---------- | --------------: | ------: |
| Statements |     6692 / 8438 |  79.30% |
| Branches   |     3698 / 5220 |  70.84% |
| Functions  |     1490 / 1844 |  80.80% |
| Lines      |     6241 / 7631 |  81.78% |

The coverage run passed 110 test files and 1127 tests. Generated local reports are `coverage/coverage-summary.json`, `coverage/index.html`, and `coverage/lcov.info`; the ignored `coverage/` directory is a build artifact, not repository source. These values are evidence only and are not thresholds.
