import { describe, expect, it } from 'vitest';
import { measureTextBlock, wrapText } from '../src/annotations/shapes';

/** 假的 2D 上下文：每个字符宽 10px，足以验证折行与测量逻辑 */
function fakeCtx(): CanvasRenderingContext2D {
  return {
    save() {},
    restore() {},
    font: '',
    textBaseline: 'top',
    measureText(s: string) {
      return { width: s.length * 10 } as TextMetrics;
    },
  } as unknown as CanvasRenderingContext2D;
}

describe('wrapText', () => {
  it('未给换行宽度时只按 \\n 分行（旧数据行为不变）', () => {
    expect(wrapText(fakeCtx(), 'abcdef\nxy', 12)).toEqual(['abcdef', 'xy']);
  });

  it('超过换行宽度时逐字符折行', () => {
    // 每字 10px，宽度 35px → 每行最多 3 个字符
    expect(wrapText(fakeCtx(), 'abcdefgh', 12, 35)).toEqual(['abc', 'def', 'gh']);
  });

  it('中文同样可以在任意字符处折行（没有空格也能断）', () => {
    expect(wrapText(fakeCtx(), '一二三四五六', 12, 30)).toEqual(['一二三', '四五六']);
  });

  it('显式换行与自动换行叠加', () => {
    expect(wrapText(fakeCtx(), 'abcd\nef', 12, 25)).toEqual(['ab', 'cd', 'ef']);
  });

  it('单字符宽度超过上限时仍保留该字符，不死循环', () => {
    expect(wrapText(fakeCtx(), 'ab', 12, 5)).toEqual(['a', 'b']);
  });
});

describe('measureTextBlock 与换行', () => {
  it('高度随折行行数增加，宽度不超过换行宽度', () => {
    const m = measureTextBlock(fakeCtx(), 'abcdefgh', 10, 35);
    expect(m.width).toBeLessThanOrEqual(35);
    expect(m.height).toBeCloseTo(3 * 10 * 1.3);
  });
});
