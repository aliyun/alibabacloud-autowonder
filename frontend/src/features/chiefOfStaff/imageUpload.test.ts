import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@/shared/i18n';
import {
  IMAGE_ACCEPT,
  IMAGE_MAX_FILE_BYTES,
  IMAGE_MAX_IMAGES,
  IMAGE_MAX_TOTAL_BYTES,
  IMAGE_UPLOAD_MESSAGES,
  validateImageSelection,
} from './imageUpload';

function image(name: string, options: { size?: number; type?: string } = {}): File {
  return new File([new Uint8Array(options.size ?? 4)], name, { type: options.type ?? 'image/png' });
}

const emptyContext = { existingCount: 0, existingTotalBytes: 0 };

afterEach(async () => { await i18n.changeLanguage('zh-CN'); });

describe('chiefOfStaff image rules', () => {
  it('accepts the image formats the server can decode', () => {
    expect(IMAGE_ACCEPT).toBe('image/png,image/jpeg,image/webp');
    expect(validateImageSelection([], emptyContext)).toEqual({ ok: true });
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(validateImageSelection([image('shot', { type })], emptyContext)).toEqual({ ok: true });
    }
  });

  it('accepts same-named screenshots with different bytes', () => {
    const first = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' });
    const second = new File([new Uint8Array([4, 5, 6, 7])], 'image.png', { type: 'image/png' });
    expect(validateImageSelection([first, second], emptyContext)).toEqual({ ok: true });
    expect(validateImageSelection([second], { existingCount: 1, existingTotalBytes: first.size })).toEqual({ ok: true });
  });

  it('accepts a same-named and byte-identical screenshot too', () => {
    const bytes = new Uint8Array([9, 9, 9]);
    const copy = () => new File([bytes], 'image.png', { type: 'image/png' });
    expect(validateImageSelection([copy()], { existingCount: 1, existingTotalBytes: copy().size })).toEqual({ ok: true });
    expect(validateImageSelection([copy(), copy()], emptyContext)).toEqual({ ok: true });
  });

  it('rejects unsupported content types before other limits', () => {
    expect(validateImageSelection([image('ok.png'), image('anim.gif', { type: 'image/gif' })], emptyContext)).toEqual({
      ok: false,
      message: IMAGE_UPLOAD_MESSAGES.unsupportedType,
    });
    expect(validateImageSelection([image('huge.gif', { type: 'image/gif', size: IMAGE_MAX_FILE_BYTES + 1 })], emptyContext)).toEqual({
      ok: false,
      message: IMAGE_UPLOAD_MESSAGES.unsupportedType,
    });
  });

  it('allows exactly 5 MB per image and rejects one byte more', () => {
    expect(IMAGE_MAX_FILE_BYTES).toBe(5 * 1024 * 1024);
    expect(validateImageSelection([image('ok.png'), image('exact.png', { size: IMAGE_MAX_FILE_BYTES })], emptyContext)).toEqual({ ok: true });
    expect(validateImageSelection([image('small.png'), image('big.png', { size: IMAGE_MAX_FILE_BYTES + 1 })], emptyContext)).toEqual({
      ok: false,
      message: IMAGE_UPLOAD_MESSAGES.fileTooLarge,
    });
  });

  it('caps the image count at ten across the existing draft', () => {
    expect(IMAGE_MAX_IMAGES).toBe(10);
    expect(validateImageSelection([image('extra.png')], { existingCount: 9, existingTotalBytes: 0 })).toEqual({ ok: true });
    expect(validateImageSelection([image('a.png'), image('b.png')], { existingCount: 9, existingTotalBytes: 0 })).toEqual({
      ok: false,
      message: IMAGE_UPLOAD_MESSAGES.tooMany,
    });
  });

  it('allows exactly 20 MB in total and rejects more', () => {
    expect(IMAGE_MAX_TOTAL_BYTES).toBe(20 * 1024 * 1024);
    const fiveMegabytes = () => image('part.png', { size: IMAGE_MAX_FILE_BYTES });
    expect(validateImageSelection([fiveMegabytes(), fiveMegabytes(), fiveMegabytes(), fiveMegabytes()], emptyContext)).toEqual({ ok: true });
    expect(validateImageSelection([fiveMegabytes()], { existingCount: 1, existingTotalBytes: 15 * 1024 * 1024 })).toEqual({ ok: true });
    expect(validateImageSelection([image('edge.png', { size: 1 })], { existingCount: 1, existingTotalBytes: IMAGE_MAX_TOTAL_BYTES })).toEqual({
      ok: false,
      message: IMAGE_UPLOAD_MESSAGES.totalTooLarge,
    });
  });

  it('reports every rejection in image-specific copy for both locales', async () => {
    await i18n.changeLanguage('en-US');
    expect(IMAGE_UPLOAD_MESSAGES.unsupportedType).toBe('PNG, JPEG, and WebP images are supported.');
    expect(IMAGE_UPLOAD_MESSAGES.fileTooLarge).toBe('Each image cannot exceed 5 MB.');
    expect(IMAGE_UPLOAD_MESSAGES.tooMany).toBe('Add up to 10 images.');
    expect(IMAGE_UPLOAD_MESSAGES.totalTooLarge).toBe('Total image size cannot exceed 20 MB.');
    await i18n.changeLanguage('zh-CN');
    expect(IMAGE_UPLOAD_MESSAGES.unsupportedType).toBe('支持 PNG、JPEG 和 WebP 图片。');
    expect(IMAGE_UPLOAD_MESSAGES.fileTooLarge).toBe('单张图片不能超过 5 MB');
    expect(IMAGE_UPLOAD_MESSAGES.tooMany).toBe('最多添加 10 张图片');
    expect(IMAGE_UPLOAD_MESSAGES.totalTooLarge).toBe('图片总大小不能超过 20 MB');
  });
});
