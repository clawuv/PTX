import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { verifyTestingAssets } from '../scripts/release/verify-testing-assets.mjs'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'ptx-release-assets-'))
  directories.push(directory)
  for (const extension of ['dmg', 'zip', 'exe', 'AppImage', 'deb', 'rpm', 'pacman', 'tar.gz']) writeFileSync(join(directory, `Ptx.${extension}`), extension)
  for (const [manifest, extension] of [['latest-mac.yml', 'zip'], ['latest.yml', 'exe'], ['latest-linux.yml', 'AppImage']]) {
    const file = { url: `Ptx.${extension}`, size: extension.length, sha512: createHash('sha512').update(extension).digest('base64') }
    writeFileSync(join(directory, manifest), JSON.stringify({ version: '1.0.1', files: [file], path: file.url, sha512: file.sha512 }))
  }
  return directory
}
it('verifies three platform feeds and writes reproducible checksums', () => {
  const directory = fixture()
  expect(verifyTestingAssets(directory, '1.0.1')).toHaveLength(11)
  const checksums = readFileSync(join(directory, 'SHA256SUMS.txt'), 'utf8')
  verifyTestingAssets(directory, '1.0.1')
  expect(readFileSync(join(directory, 'SHA256SUMS.txt'), 'utf8')).toBe(checksums)
})
it('rejects corrupted installers and mismatched versions before publishing', () => {
  const directory = fixture()
  expect(() => verifyTestingAssets(directory, '1.0.2')).toThrow('Invalid version')
  writeFileSync(join(directory, 'Ptx.exe'), 'corrupted')
  expect(() => verifyTestingAssets(directory, '1.0.1')).toThrow('checksum mismatch')
})
it('rejects a feed pointing outside the artifact directory', () => {
  const directory = fixture()
  writeFileSync(join(directory, 'latest.yml'), JSON.stringify({ version: '1.0.1', files: [{ url: '../secret' }], path: '../secret', sha512: '' }))
  expect(() => verifyTestingAssets(directory, '1.0.1')).toThrow('unsafe asset')
})
