import { app, BrowserWindow, clipboard, ClipboardItem, dialog, nativeImage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { toBlob } from '../shared/bytes';
import type { SaveFormat } from '../shared/types';

/** 默认导出：写入剪贴板（宿主通过 onExport 接管时不会走到这里）。 */
export async function copyPng(png: Uint8Array): Promise<void> {
  if (png.byteLength === 0) throw new Error('图片数据为空');
  await clipboard.write([new ClipboardItem({ 'image/png': toBlob(png, 'image/png') })]);
}

export function copyText(text: string): void {
  if (!text) throw new Error('文本为空');
  clipboard.writeText(text);
}

export function defaultSnipName(format: SaveFormat = 'png'): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return (
    `snip_${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `_${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}-${ms}.${format}`
  );
}

export interface SavePngOptions {
  /** 默认保存目录，缺省为系统「图片」目录 */
  saveDir?: string;
  format?: SaveFormat;
  suggestedName?: string;
}

/**
 * 默认保存：弹系统保存框。只有**可见**的置顶窗口才需要先降级（否则对话框被它盖住）；
 * 保存成功后把文件路径放进剪贴板，方便直接粘贴分享。
 *
 * @returns 保存后的路径，取消返回 null。
 */
export async function savePng(
  win: BrowserWindow | null,
  png: Uint8Array,
  opts: SavePngOptions = {},
): Promise<string | null> {
  const owner = win && !win.isDestroyed() && win.isVisible() ? win : null;
  const wasOnTop = !!owner && owner.isAlwaysOnTop();
  if (owner && wasOnTop) owner.setAlwaysOnTop(false);
  try {
    const dialogOpts = {
      title: '保存截图',
      defaultPath: path.join(
        opts.saveDir || app.getPath('pictures'),
        opts.suggestedName ?? defaultSnipName(opts.format),
      ),
      filters: [
        { name: 'PNG 图片', extensions: ['png'] },
        { name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] },
      ],
    };
    const { canceled, filePath } = owner
      ? await dialog.showSaveDialog(owner, dialogOpts)
      : await dialog.showSaveDialog(dialogOpts);
    if (canceled || !filePath) return null;
    let data: Buffer = Buffer.from(png);
    let target = filePath;
    if (/\.jpe?g$/i.test(target)) {
      // JPG 走原生编码器（PNG 保存原始字节，避免重编码损失）
      data = nativeImage.createFromBuffer(data).toJPEG(92);
    } else if (!/\.png$/i.test(target)) {
      target += '.png';
    }
    await fs.writeFile(target, data);
    clipboard.writeText(target);
    return target;
  } finally {
    if (owner && wasOnTop) owner.setAlwaysOnTop(true, 'floating');
  }
}
