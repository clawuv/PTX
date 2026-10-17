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

## Additional native platform builds

The manually dispatched `testing-platforms.yml` workflow builds Windows x64 on Windows Server 2022 and Linux x64 on Ubuntu 22.04. It checks out the immutable v1.0.0 application commit `744a69bef6b019938db94a953efac98c383d22b0`, independently of the workflow revision. It runs the toolchain check, production audit, type checks, native QA packaging, structural verification, and packaged application startup smoke. It does not claim that the known failing full CI suite passes.

Download successful workflow artifacts, verify each update manifest's file sizes and SHA-512 hashes, and upload the installers, update manifests, blockmaps, and platform-specific SHA-256 lists to the existing prerelease. Preserve the original macOS artifacts and tag. Windows installers are unsigned; unsigned AppX/MSIX files are not a normal end-user installation path, so publish the EXE/ZIP instead. Linux provides AppImage, DEB, RPM, and pacman packages. The release notes must distinguish startup verification from a complete installation or future-version upgrade test.

## Publish the next testing version with GitHub Actions

Use **Actions → Publish testing release → Run workflow**. Enter an existing tag such as `v1.0.1`. The tag must point to a commit on `main`, and match the versions in `package.json` and both lockfile version fields. Use a new version; the workflow refuses to replace a published release. The application commit must include the reusable workflow's release verifier and tests.

Example preparation after committing the desired fixes:

```sh
npm version 1.0.1 --no-git-tag-version
git add package.json package-lock.json
git commit -m "release: prepare v1.0.1 testing build"
git push origin main
git tag -a v1.0.1 -m "Ptx v1.0.1 testing release"
git push origin v1.0.1
gh workflow run testing-platforms.yml --ref main -f tag=v1.0.1
```

The workflow validates the tag, pins its commit, checks types/lint/dependencies and update/release tests, builds macOS arm64, Windows x64 and Linux x64 natively, then checks packaged startup. Only after every platform succeeds does it verify the update feeds, generate `SHA256SUMS.txt`, upload a draft, and publish it as a prerelease. Failed uploads leave a draft that can be retried against the same commit. No signing secrets are needed; repository Actions must be permitted to write release contents.

This is an explicitly unsigned QA path, not the full production acceptance suite. The signed release workflow remains available by manual dispatch; automatic signed releases on tag push require repository variable `RELEASE_SIGNED_ENABLED=true` and all signing/notarization credentials. Leave it unset for unsigned testing releases.

The button to the right of Settings checks the installed build's GitHub update source and shows the result. A discovered update requires confirmation before download/install; unsigned macOS builds open the download page for manual installation. Development builds show the unavailable tooltip. Updating from 1.0.0 requires a higher version such as 1.0.1, rather than replacing the 1.0.0 assets.
