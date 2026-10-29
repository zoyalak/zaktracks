/** Client-side photo handling: resize + compress before anything leaves the phone. */

export interface PhotoResult {
  dataUrl: string
  width: number
  height: number
  bytes: number
}

/**
 * Convert an image file into a JPEG data URL, downscaling it to `maxDim` so
 * uploads stay small and the UI stays fast.
 */
export async function fileToDataUrl(file: Blob, maxDim = 1024, quality = 0.8): Promise<PhotoResult> {
  const bitmap = await decode(file)
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not supported in this browser')
  ctx.drawImage(bitmap.source, 0, 0, width, height)
  if ('close' in bitmap.source && typeof bitmap.source.close === 'function') bitmap.source.close()

  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  return { dataUrl, width, height, bytes: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75) }
}

interface Decoded {
  source: ImageBitmap | HTMLImageElement
  width: number
  height: number
}

async function decode(file: Blob): Promise<Decoded> {
  // createImageBitmap honours EXIF orientation on modern browsers.
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bmp, width: bmp.width, height: bmp.height }
    } catch {
      /* fall through to <img> decoding */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not read that image'))
      el.src = url
    })
    if (!img.naturalWidth) throw new Error('Could not read that image')
    return { source: img, width: img.naturalWidth, height: img.naturalHeight }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}

export const formatBytes = (bytes: number): string =>
  bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
