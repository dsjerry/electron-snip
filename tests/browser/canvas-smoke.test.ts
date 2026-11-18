import { describe, expect, it } from 'vitest';

describe('浏览器环境（真实 Chromium）', () => {
  it('canvas 2d 上下文可用，像素读写正确', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
    ctx!.fillStyle = '#ff0000';
    ctx!.fillRect(0, 0, 4, 4);
    const px = ctx!.getImageData(1, 1, 1, 1).data;
    expect(Array.from(px)).toEqual([255, 0, 0, 255]);
  });
});
