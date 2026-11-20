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
  const init = (x: number, y: number) => ({
    clientX: x,
    clientY: y,
    button: 0,
    bubbles: true,
    pointerId: 1,
    buttons: 1,
  });
  canvas.dispatchEvent(new PointerEvent('pointerdown', init(from[0], from[1])));
  window.dispatchEvent(new PointerEvent('pointermove', init(to[0], to[1])));
  window.dispatchEvent(new PointerEvent('pointerup', init(to[0], to[1])));
}

describe('选中图形后在空白处拖动', () => {
  it('点击选中矩形后，在远处空白拖动应画新图形，原图形不变', () => {
    const { canvas, editor } = setup();
    editor.setTool('rect');
    drag(canvas, [20, 20], [120, 90]);
    const original = editor.getShapes()[0];
    // 点击矩形内部把它选中（整体移动模式，没有真动过）
    drag(canvas, [70, 55], [70, 55]);
    expect(editor.getShapes()[0]).toEqual(original);
    // 远处空白按下并拖动
    drag(canvas, [300, 250], [340, 280]);
    const shapes = editor.getShapes();
    expect(shapes).toHaveLength(2);
    expect(shapes[0]).toEqual(original);
    expect(shapes[1]).toMatchObject({ type: 'rect', x: 300, y: 250 });
  });
});
