import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createFromBuffer: vi.fn() }))
vi.mock('electron', () => ({ nativeImage: { createFromBuffer: mocks.createFromBuffer } }))
import { detectImageMimeType, prepareSessionImage } from '../../electron/main/feishu/image'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const withBytes = (head: Buffer, bytes: number) => Buffer.concat([head, Buffer.alloc(bytes)])
const png = (bytes: number) => withBytes(PNG_SIGNATURE, bytes)
const jpeg = (bytes: number) => withBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), bytes)
const gif = (bytes: number) => withBytes(Buffer.from('GIF89a', 'latin1'), bytes)
const webp = (bytes: number) => Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1'), Buffer.alloc(bytes)])

/** Fake nativeImage whose JPEG encodings scale with width and quality; every resize is recorded. */
function fakeImage(width: number, weight: number, resizes: number[] = []) {
  return {
    isEmpty: () => false,
    getSize: () => ({ width, height: Math.round(width * 0.75) }),
    toJPEG: (quality: number) => Buffer.alloc(Math.ceil((width * weight * quality) / 85)),
    resize: (options: { width: number }) => {
      resizes.push(options.width)
      return fakeImage(options.width, weight, resizes)
    },
  }
}

beforeEach(() => { mocks.createFromBuffer.mockReset() })

describe('detectImageMimeType', () => {
  it('recognizes the four supported signatures', () => {
    expect(detectImageMimeType(png(16))).toBe('image/png')
    expect(detectImageMimeType(jpeg(16))).toBe('image/jpeg')
    expect(detectImageMimeType(withBytes(Buffer.from('GIF87a', 'latin1'), 8))).toBe('image/gif')
    expect(detectImageMimeType(gif(16))).toBe('image/gif')
    expect(detectImageMimeType(webp(16))).toBe('image/webp')
  })
  it('rejects truncated signatures, unknown formats and short buffers', () => {
    expect(detectImageMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeUndefined()
    expect(detectImageMimeType(withBytes(Buffer.from('GIF8', 'latin1'), 16))).toBeUndefined()
    expect(detectImageMimeType(withBytes(Buffer.from('RIFF', 'latin1'), 16))).toBeUndefined()
    expect(detectImageMimeType(Buffer.alloc(64, 0x41))).toBeUndefined()
    expect(detectImageMimeType(Buffer.alloc(8))).toBeUndefined()
  })
})

describe('prepareSessionImage', () => {
  it('passes small images through as canonical base64 without decoding them', () => {
    const small = png(64)
    expect(prepareSessionImage(small)).toEqual({ type: 'image', data: small.toString('base64'), mimeType: 'image/png' })
    expect(mocks.createFromBuffer).not.toHaveBeenCalled()
  })
  it('rejects oversize gif and webp without attempting native compression', () => {
    expect(prepareSessionImage(gif(2_000_000))).toEqual({ error: expect.stringContaining('无法自动压缩') })
    expect(prepareSessionImage(webp(2_000_000))).toEqual({ error: expect.stringContaining('无法自动压缩') })
    expect(mocks.createFromBuffer).not.toHaveBeenCalled()
  })
  it('downscales oversize png through the resize ladder until the frame budget fits', () => {
    const resizes: number[] = []
    mocks.createFromBuffer.mockReturnValue(fakeImage(4096, 500, resizes))
    // Full-size toJPEG(85) is 2,048,000 bytes (≈2.73M base64 chars, over budget);
    // the 2048-wide candidate is 1,024,000 bytes (≈1.37M chars) and fits. Every
    // ladder candidate is encoded up front, so all widths are recorded.
    const result = prepareSessionImage(png(2_000_000))
    expect(resizes).toEqual([2048, 1568, 1216, 1024, 768, 768])
    expect(result).toEqual({ type: 'image', data: Buffer.alloc(1_024_000).toString('base64'), mimeType: 'image/jpeg' })
  })
  it('falls back to the aggressive 60-quality re-encode when every 85-quality candidate is too large', () => {
    const resizes: number[] = []
    mocks.createFromBuffer.mockReturnValue(fakeImage(4096, 2400, resizes))
    // 768px at quality 85 is 1,843,200 bytes (still over); at quality 60 it is
    // ceil(768 * 2400 * 60 / 85) = 1,301,083 bytes and fits.
    const result = prepareSessionImage(png(2_000_000))
    expect(resizes).toEqual([2048, 1568, 1216, 1024, 768, 768])
    expect(result).toEqual({ type: 'image', data: Buffer.alloc(1_301_083).toString('base64'), mimeType: 'image/jpeg' })
  })
  it('gives up when even the smallest 60-quality candidate exceeds the budget', () => {
    mocks.createFromBuffer.mockReturnValue(fakeImage(4096, 4000))
    expect(prepareSessionImage(png(2_000_000))).toEqual({ error: '图片过大，压缩后仍超过会话支持的大小。' })
  })
  it('reports undecodable images instead of sending garbage', () => {
    mocks.createFromBuffer.mockReturnValue({ isEmpty: () => true })
    expect(prepareSessionImage(png(2_000_000))).toEqual({ error: '图片解码失败，无法压缩到会话支持的大小。' })
  })
  it('rejects unknown formats before any compression work', () => {
    expect(prepareSessionImage(Buffer.alloc(64, 0x41))).toEqual({ error: '仅支持 png / jpg / gif / webp 图片。' })
    expect(mocks.createFromBuffer).not.toHaveBeenCalled()
  })
})
