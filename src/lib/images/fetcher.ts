import type { ExtractedImage } from '../extractors/types';

export interface FetchedImage {
  url: string;
  base64: string;
  mimeType: string;
  tier: 'inline' | 'contextual';
  alt: string;
  caption?: string;
}

const SUPPORTED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 1_024_000; // 1 MB
const FETCH_TIMEOUT_MS = 15_000;
const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.8;

export async function fetchImages(
  images: ExtractedImage[],
  maxCount = 5,
): Promise<FetchedImage[]> {
  // Prioritize inline images first, then contextual
  const sorted = [
    ...images.filter((i) => i.tier === 'inline'),
    ...images.filter((i) => i.tier === 'contextual'),
  ].slice(0, maxCount);

  const results: FetchedImage[] = [];

  for (const img of sorted) {
    try {
      const fetched = await fetchSingleImage(img);
      if (fetched) results.push(fetched);
    } catch {
      // Skip failed images silently
    }
  }

  return results;
}

async function fetchSingleImage(img: ExtractedImage): Promise<FetchedImage | null> {
  // Handle data: URIs directly (e.g. from PDF image extraction)
  if (img.url.startsWith('data:')) {
    try {
      // Parse the data URI directly — don't use fetch() which may fail in service workers
      const match = img.url.match(/^data:(image\/[^;]+);base64,(.+)$/s);
      if (!match) {
        console.warn('[xTil] data URI regex mismatch, prefix:', img.url.substring(0, 80));
        return null;
      }
      const mimeType = match[1];
      const base64 = match[2];

      if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
        console.warn('[xTil] data URI unsupported mime:', mimeType);
        return null;
      }

      // Check size (base64 is ~4/3 of binary)
      const estimatedBytes = Math.ceil(base64.length * 3 / 4);
      console.log(`[xTil] data URI image: ${mimeType}, ~${Math.round(estimatedBytes / 1024)}KB`);
      if (estimatedBytes > MAX_IMAGE_BYTES) {
        // Decode to blob and resize
        const byteChars = atob(base64);
        const bytes = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
        return await resizeAndEncode(new Blob([bytes], { type: mimeType }), img);
      }

      return { url: img.url, base64, mimeType, tier: img.tier, alt: img.alt, caption: img.caption };
    } catch (err) {
      console.error('[xTil] data URI processing failed:', err);
      return null;
    }
  }

  // Only fetch http(s) URLs — reject file://, blob:, etc.
  try { const u = new URL(img.url); if (u.protocol !== 'https:' && u.protocol !== 'http:') return null; } catch { return null; }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(img.url, { signal: controller.signal });
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return null;

    const blob = await response.blob();
    const mimeType = blob.type || contentType.split(';')[0] || 'image/jpeg';

    // LLM APIs only support JPEG, PNG, and WEBP — convert anything else (e.g. GIF)
    if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
      return await resizeAndEncode(blob, img);
    }

    if (blob.size > MAX_IMAGE_BYTES) {
      // Try to resize
      return await resizeAndEncode(blob, img);
    }

    const base64 = await blobToBase64(blob);

    return { url: img.url, base64, mimeType, tier: img.tier, alt: img.alt, caption: img.caption };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resizeAndEncode(blob: Blob, img: ExtractedImage): Promise<FetchedImage | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;

    // Calculate scaled dimensions
    let newWidth = width;
    let newHeight = height;
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const scale = MAX_DIMENSION / Math.max(width, height);
      newWidth = Math.round(width * scale);
      newHeight = Math.round(height * scale);
    }

    const canvas = new OffscreenCanvas(newWidth, newHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(bitmap, 0, 0, newWidth, newHeight);
    bitmap.close();

    const resizedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
    if (resizedBlob.size > MAX_IMAGE_BYTES) return null; // still too big after resize

    const base64 = await blobToBase64(resizedBlob);
    return { url: img.url, base64, mimeType: 'image/jpeg', tier: img.tier, alt: img.alt, caption: img.caption };
  } catch {
    return null; // resize not supported or failed
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Strip the data:...;base64, prefix — providers format differently
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
