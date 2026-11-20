import { describe, expect, it } from 'vitest';
import { Editor } from '../../src/annotations/editor';

function setup() {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 300;
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:300px';
  document.body.appendChild(canvas);
  const textEditor = document.createElement('textarea');
  document.body.appendChild(textEditor);
  const editor = new Editor(canvas, textEditor, { repaint: () => {}, coords: 'css' });
  return { canvas, editor };
}

function drag(canvas: HTMLCanvasElement, from: [number, number], to: [number, number]): void {
  const init = (x: number, y: number, buttons: number) => ({
    clientX: x,
    clientY: y,
    button: 0,
    buttons,
    bubbles: true,
    pointerId: 1,
  });
  canvas.dispatchEvent(new PointerEvent('pointerdown', init(from[0], from[1], 1)));
  window.dispatchEvent(new PointerEvent('pointermove', init(to[0], to[1], 1)));
  window.dispatchEvent(new PointerEvent('pointerup', init(to[0], to[1], 0)));
}

describe('拖动圆边移动后松手，再在空白处拖动', () => {
  it('松手后选中消失，新的拖动开始新的绘制，原图形不再动', () => {
    const { canvas, editor } = setup();
    editor.setTool('ellipse');
    drag(canvas, [50, 50], [150, 100]); // 画椭圆 center(100,75) rx=50 ry=25
    const before = editor.getShapes()[0];
    // 拖动椭圆右侧边缘松手：移动
    drag(canvas, [150, 75], [170, 85]);
    const moved = editor.getShapes()[0];
    expect(moved).not.toEqual(before);
    // 松手后，在远处空白按下拖动：应该画新图形，原图形不变
    drag(canvas, [300, 230], [340, 270]);
    const shapes = editor.getShapes();
    expect(shapes).toHaveLength(2);
    expect(shapes[0]).toEqual(moved);
    expect(shapes[1]).toMatchObject({ type: 'ellipse', x: 300, y: 230 });
  });
});
