import { AppError } from '../errors/AppError.js';

type ImgbbSuccessResponse = {
  data: {
    url: string;
    display_url: string;
  };
  success: boolean;
  status: number;
};

type ImgbbErrorResponse = {
  error?: {
    message?: string;
  };
  status?: number;
};

/**
 * Uploads an image buffer to imgbb and returns the hosted URL.
 * Used by the admin poster upload endpoint — keeps HTTP details out of routes.
 */
export async function uploadToImgbb(
  apiKey: string,
  imageBuffer: Buffer,
  filename: string,
): Promise<string> {
  if (!apiKey) {
    throw new AppError('Image upload is not configured', 503, 'SERVICE_UNAVAILABLE');
  }

  const body = new URLSearchParams();
  body.set('key', apiKey);
  body.set('name', filename);
  body.set('image', imageBuffer.toString('base64'));

  const response = await fetch('https://api.imgbb.com/1/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const payload = (await response.json()) as ImgbbSuccessResponse & ImgbbErrorResponse;

  if (!response.ok || !payload.success) {
    const message = payload.error?.message ?? 'Failed to upload image';
    throw new AppError(message, 502, 'UPSTREAM_ERROR');
  }

  return payload.data.display_url ?? payload.data.url;
}
