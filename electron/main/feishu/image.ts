import { nativeImage } from 'electron'

/**
 * Mobile images must survive the agent RPC write-frame budget, which caps each
 * base64 attachment well below Feishu's 10 MB upload ceiling. Photos therefore
 * get downscaled/re-encoded through Electron's nativeImage; gif/webp cannot be
 * re-encoded and stay pass-through only.
 */
const BASE64_CHAR_BUDGET = 1_800_000
const RESIZE_WIDTHS = [2048, 1568, 1216, 1024, 768]

export type SessionImage = { type: 'image'; data: string; mimeType: string }

export function detectImageMimeType(buffer: Buffer): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | undefined {
  // Mirrors the RPC command-schema magic-byte checks so a file admitted here
  // cannot fail downstream validation with only a generic engine failure.
  if (buffer.length < 12) return undefined
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  const head = buffer.subarray(0, 6).toString('latin1')
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif'
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return undefined
}

export function prepareSessionImage(buffer: Buffer): SessionImage | { error: string } {
  const mimeType = detectImageMimeType(buffer)
  if (!mimeType) return { error: '仅支持 png / jpg / gif / webp 图片。' }
  const direct = buffer.toString('base64')
  if (direct.length <= BASE64_CHAR_BUDGET) return { type: 'image', data: direct, mimeType }
  if (mimeType === 'image/gif' || mimeType === 'image/webp') {
    return { error: '图片超过会话支持的大小，且 gif / webp 无法自动压缩，请发送更小的图片或改用 png / jpg。' }
  }
  const source = nativeImage.createFromBuffer(buffer)
  if (source.isEmpty()) return { error: '图片解码失败，无法压缩到会话支持的大小。' }
  const candidates: Buffer[] = [source.toJPEG(85)]
  const width = source.getSize().width
  for (const maxSide of RESIZE_WIDTHS) {
    if (width > maxSide) candidates.push(source.resize({ width: maxSide }).toJPEG(85))
  }
  candidates.push(source.resize({ width: RESIZE_WIDTHS[RESIZE_WIDTHS.length - 1] }).toJPEG(60))
  for (const candidate of candidates) {
    const data = candidate.toString('base64')
    if (data.length <= BASE64_CHAR_BUDGET) return { type: 'image', data, mimeType: 'image/jpeg' }
  }
  return { error: '图片过大，压缩后仍超过会话支持的大小。' }
}
