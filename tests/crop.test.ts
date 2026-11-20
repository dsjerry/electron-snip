import { describe, expect, it } from 'vitest';
import { cropShot } from '../src/shared/crop';
import type { DisplayShot } from '../src/shared/types';

/** 2x 缩放的 4×3 DIP 屏：每个物理像素的 R 通道记录它的 (x, y) 位置，便于断言裁剪是否对齐 */
function shotAt2x(): DisplayShot {
  const imageWidth = 8;
  const imageHeight = 6;
  const pixels = new Uint8Array(imageWidth * imageHeight * 4);
  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      const i = (y * imageWidth + x) * 4;
      pixels[i] = x;
      pixels[i + 1] = y;
      pixels[i + 2] = 0;
      pixels[i + 3] = 255;
    }
  }
  return {
    displayId: 1,
    bounds: { x: 100, y: 50, width: 4, height: 3 },
    scaleX: 2,
    scaleY: 2,
    imageWidth,
    imageHeight,
    pixels,
  } as DisplayShot;
}

describe('cropShot：按选区裁出物理像素', () => {
  it('按缩放换算到物理像素，左上角与尺寸正确', () => {
    const shot = shotAt2x();
    // 选区 DIP (101,51) 2x2 → 物理 (2,2) 4x4
    const out = cropShot(shot, { x: 101, y: 51, width: 2, height: 2 });
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    expect(out.pixels[0]).toBe(2); // 第一个像素的 x
    expect(out.pixels[1]).toBe(2); // 第一个像素的 y
  });

  it('选区越出屏幕边缘时裁到屏内，尺寸不为 0', () => {
    const out = cropShot(shotAt2x(), { x: 103, y: 52, width: 10, height: 10 });
    expect(out.width).toBeGreaterThanOrEqual(1);
    expect(out.height).toBeGreaterThanOrEqual(1);
    expect(out.pixels.length).toBe(out.width * out.height * 4);
  });
});
