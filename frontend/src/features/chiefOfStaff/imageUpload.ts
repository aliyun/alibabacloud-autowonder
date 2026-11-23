import { i18n } from '@/shared/i18n';

/**
 * Chief conversation images are stored under a UUID object key and are never keyed by name, so
 * unlike requirement/design documents they must not be deduplicated by filename: screenshot tools
 * name every capture `image.png`.
 */
export const IMAGE_MAX_IMAGES = 10;
export const IMAGE_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const IMAGE_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

const IMAGE_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export const IMAGE_UPLOAD_MESSAGES = {
  get unsupportedType() { return i18n.t('chiefOfStaff:imageTypes'); },
  get fileTooLarge() { return i18n.t('chiefOfStaff:imageTooLarge'); },
  get tooMany() { return i18n.t('chiefOfStaff:imageTooMany', { max: IMAGE_MAX_IMAGES }); },
  get totalTooLarge() { return i18n.t('chiefOfStaff:imageTotalTooLarge'); },
};

export interface ImageSelectionContext {
  existingCount: number;
  existingTotalBytes: number;
}

export type ImageSelectionVerdict = { ok: true } | { ok: false; message: string };

export function validateImageSelection(
  files: readonly File[],
  context: ImageSelectionContext,
): ImageSelectionVerdict {
  if (files.length === 0) return { ok: true };
  if (files.some((file) => !IMAGE_CONTENT_TYPES.has(file.type))) {
    return { ok: false, message: IMAGE_UPLOAD_MESSAGES.unsupportedType };
  }
  if (files.some((file) => file.size > IMAGE_MAX_FILE_BYTES)) {
    return { ok: false, message: IMAGE_UPLOAD_MESSAGES.fileTooLarge };
  }
  if (context.existingCount + files.length > IMAGE_MAX_IMAGES) {
    return { ok: false, message: IMAGE_UPLOAD_MESSAGES.tooMany };
  }
  const selectedBytes = files.reduce((total, file) => total + file.size, 0);
  if (context.existingTotalBytes + selectedBytes > IMAGE_MAX_TOTAL_BYTES) {
    return { ok: false, message: IMAGE_UPLOAD_MESSAGES.totalTooLarge };
  }
  return { ok: true };
}
