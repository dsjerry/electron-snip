import { describe, expect, it } from 'vitest';
import { Editor } from '../../src/annotations/editor';

function setup() {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 300;
  canvas.style.width = '400px';
  canvas.style.height = '300px';
  document.body.appendChild(canvas);
  const textEditor = document.createElement('textarea');
  document.body.appendChild(textEditor);
  const editor = new Editor(canvas, textEditor, { repaint: () => {}, coords: 'css' });
  return { canvas, editor };
}

/** 用真实指针事件在画布上拖出一个矩形 */
function drawRect(canvas: HTMLCanvasElement, from: [number, number], to: [number, number]): void {
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

describe('Editor 撤销 / 重做（真实指针事件）', () => {
  it('画一笔后可撤销，撤销后可重做', () => {
    const { canvas, editor } = setup();
    editor.setTool('rect');
    drawRect(canvas, [20, 20], [120, 90]);
    expect(editor.getShapes()).toHaveLength(1);
    expect(editor.canUndo).toBe(true);

    editor.undo();
    expect(editor.getShapes()).toHaveLength(0);
    expect(editor.canRedo).toBe(true);

    editor.redo();
    expect(editor.getShapes()).toHaveLength(1);
    expect(editor.canRedo).toBe(false);
  });

  it('新的变更会清空重做栈', () => {
    const { canvas, editor } = setup();
    editor.setTool('rect');
    drawRect(canvas, [20, 20], [120, 90]);
    editor.undo();
    expect(editor.canRedo).toBe(true);
    drawRect(canvas, [150, 40], [250, 140]);
    expect(editor.canRedo).toBe(false);
    expect(editor.getShapes()).toHaveLength(1);
  });

  it('清空可以撤销', () => {
    const { canvas, editor } = setup();
    editor.setTool('rect');
    drawRect(canvas, [20, 20], [120, 90]);
    drawRect(canvas, [150, 40], [250, 140]);
    expect(editor.getShapes()).toHaveLength(2);
    editor.clear();
    expect(editor.getShapes()).toHaveLength(0);
    editor.undo();
    expect(editor.getShapes()).toHaveLength(2);
  });

  it('getShapes 返回深拷贝，外部修改不影响编辑器内部状态', () => {
    const { canvas, editor } = setup();
    editor.setTool('rect');
    drawRect(canvas, [20, 20], [120, 90]);
    const snapshot = editor.getShapes();
    snapshot.length = 0;
    expect(editor.getShapes()).toHaveLength(1);
  });
});
