#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { load } from 'js-yaml'

export function verifyTestingAssets(directory, version) {
  const names = readdirSync(directory)
    .filter((name) => name !== 'SHA256SUMS.txt')
    .sort()
  const allowed = /\.(?:dmg|zip|exe|AppImage|deb|rpm|pacman|tar\.gz|blockmap)$/
  const manifests = ['latest-mac.yml', 'latest.yml', 'latest-linux.yml']
  for (const name of names) {
    if (!allowed.test(name) && !manifests.includes(name)) throw new Error(`Unexpected release asset: ${name}`)
  }
  for (const manifest of manifests) {
    const feed = load(readFileSync(resolve(directory, manifest), 'utf8'))
    if (
      !feed ||
      typeof feed !== 'object' ||
      !('version' in feed) ||
      feed.version !== version ||
      !('files' in feed) ||
      !Array.isArray(feed.files) ||
      !feed.files.length ||
      !('path' in feed) ||
      !('sha512' in feed)
    )
      throw new Error(`Invalid version or files: ${manifest}`)
    for (const file of feed.files) {
      if (!file || typeof file !== 'object' || typeof file.url !== 'string' || basename(file.url) !== file.url || !names.includes(file.url)) throw new Error(`Missing or unsafe asset: ${manifest}`)
      const bytes = readFileSync(resolve(directory, file.url))
      if (bytes.length !== file.size || createHash('sha512').update(bytes).digest('base64') !== file.sha512) throw new Error(`Update checksum mismatch: ${file.url}`)
    }
    const primary = feed.files.find((file) => file.url === feed.path)
    if (!primary || primary.sha512 !== feed.sha512) throw new Error(`Invalid primary update asset: ${manifest}`)
  }
  for (const extension of ['.dmg', '.zip', '.exe', '.AppImage', '.deb', '.rpm', '.pacman', '.tar.gz']) {
    if (!names.some((name) => name.endsWith(extension))) throw new Error(`Missing installer: ${extension}`)
  }
  const checksums =
    names
      .map(
        (name) =>
          `${createHash('sha256')
            .update(readFileSync(resolve(directory, name)))
            .digest('hex')}  ${name}`,
      )
      .join('\n') + '\n'
  writeFileSync(resolve(directory, 'SHA256SUMS.txt'), checksums)
  return names
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
  const names = verifyTestingAssets(resolve(process.argv[2] ?? 'release-assets'), version)
  console.log(`Verified ${names.length} testing release assets for ${version}`)
}
