# v1.0.0 testing release

This initial release is a GitHub prerelease for macOS Apple Silicon. It is built natively from the tagged source with the local QA packaging path. It is unsigned and not notarized, and has no GitHub build-provenance attestation. It does not satisfy the signed production distribution gate.

## Build and verify

Use the repository toolchain, then run:

```sh
npm ci
npm run release:verify:package
npm run audit:production
npm run test:e2e:hermetic
npm run package:mac:local-qa -- --arch arm64
node scripts/release/smoke-packaged-app.mjs --platform mac --arch arm64
```

The QA packaging entry point writes `ptxUpdateChannel=testing` into the packaged manifest. macOS QA packages also receive `ptxUpdateInstall=manual`. Production packages receive neither flag.

The updater checks `clawuv/PTX`. Only testing builds opt into GitHub prereleases. Downloads and installation require user consent, and downgrades are disabled. Unsigned macOS test builds open the release downloads page for manual installation instead of invoking Squirrel's signed-app replacement mechanism. Signed production builds retain download-and-restart installation.

The tag `v1.0.0` is excluded from the automatic signed production workflow because this first release is published through the QA path. Later version tags retain the production workflow's signing and notarization requirements. Manually dispatching that workflow still requires all production credentials and checks.

## Publish

Publish only after inspecting verification results. Create the immutable `v1.0.0` tag on the tested commit on `main`, push it, and upload the arm64 DMG, ZIP, `latest-mac.yml`, and SHA256 checksums to a GitHub **prerelease**, with `latest=false`. Keep artifact names unchanged so the update feed URLs resolve.

Release notes must record the commit, exact checks and failures, platform, signing status, and installation limitations. Never substitute an unsigned test release for a signed production release claim.

## Installation and update testing

Download the DMG from the release page and move Ptx into Applications. macOS may block this unnotarized build; follow the normal system Privacy & Security approval flow only after verifying the source and checksum. Do not disable Gatekeeper globally.

The repository previously used version 1.1.15. Install this 1.0.0 test baseline manually; the updater intentionally will not downgrade 1.1.15. An installed 1.0.0 build checking 1.0.0 should report no newer version. Testing a real upgrade requires a later version. A successful metadata check alone does not prove automatic installation, image understanding, or task correctness.

## Initial QA validation limits

The initial local run passed type checks, formatting/lint, unit coverage, production dependency audit, bundle budgets, and focused updater tests. The desktop suite stopped after five failures (14 passed, 44 not run): pet restart at a narrow window, obsolete small-catalog model search expectations, and three settings-navigation flows. These failures remain visible and are not waived for production.

For this explicitly limited prerelease, after the separate checks above, the local packaging command was `node scripts/release/package.mjs --qa --platform mac --arch arm64 --skip-verify`. This skips repeating the aggregate; it still builds and verifies the actual DMG and ZIP. The installed application must also pass the packaged startup smoke before publication. Consult the release notes for the exact tested commit and observed results.
