import { describe, expect, it } from 'vitest';
import { Editor } from '../../src/annotations/editor';

function setup() {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 300;
  canvas.style.width = '400px';
  canvas.style.height = '300px';
  // 固定在视口左上角：多个用例会追加画布，不固定的话后面的画布会落在下方，绝对坐标错位
  canvas.style.position = 'fixed';
  canvas.style.left = '0';
  canvas.style.top = '0';
  document.body.appendChild(canvas);
  const textEditor = document.createElement('textarea');
  document.body.appendChild(textEditor);
  const editor = new Editor(canvas, textEditor, { repaint: () => {}, coords: 'css' });
  return { canvas, editor };
}

/** 真实指针事件拖动；shift 决定 shiftKey 标志 */
function drag(canvas: HTMLCanvasElement, from: [number, number], to: [number, number], shift = false): void {
  const init = (x: number, y: number) => ({
    clientX: x,
    clientY: y,
    button: 0,
    bubbles: true,
    pointerId: 1,
    buttons: 1,
    shiftKey: shift,
  });
  canvas.dispatchEvent(new PointerEvent('pointerdown', init(from[0], from[1])));
  window.dispatchEvent(new PointerEvent('pointermove', init(to[0], to[1])));
  window.dispatchEvent(new PointerEvent('pointerup', init(to[0], to[1])));
}

describe('Shift 约束绘制', () => {
  it('矩形按住 Shift 变正方形（拖向右下）', () => {
    const { canvas, editor } = setup();
    editor.setTool('rect');
    drag(canvas, [20, 20], [120, 60], true);
    const [rect] = editor.getShapes();
    expect(rect.type).toBe('rect');
    if (rect.type !== 'rect') return;
    expect(Math.abs(rect.w)).toBe(Math.abs(rect.h));
    expect(Math.abs(rect.w)).toBe(100);
  });

  it('矩形按住 Shift 变正方形（拖向左上，保留象限）', () => {
    const { canvas, editor } = setup();
    editor.setTool('rect');
    drag(canvas, [200, 200], [120, 170], true);
    const [rect] = editor.getShapes();
    if (rect.type !== 'rect') throw new Error('expected rect');
    expect(Math.abs(rect.w)).toBe(Math.abs(rect.h));
    expect(rect.w).toBeLessThan(0);
    expect(rect.h).toBeLessThan(0);
  });

  it('椭圆按住 Shift 变正圆', () => {
    const { canvas, editor } = setup();
    editor.setTool('ellipse');
    drag(canvas, [50, 50], [150, 100], true);
    const [ell] = editor.getShapes();
    if (ell.type !== 'ellipse') throw new Error('expected ellipse');
    expect(Math.abs(ell.w)).toBe(Math.abs(ell.h));
  });

  it('不按 Shift 时保持自由矩形', () => {
    const { canvas, editor } = setup();
    editor.setTool('rect');
    drag(canvas, [20, 20], [120, 60], false);
    const [rect] = editor.getShapes();
    if (rect.type !== 'rect') throw new Error('expected rect');
    expect(rect.w).toBe(100);
    expect(rect.h).toBe(40);
  });

  it('画笔按住 Shift 拖成直线（只保留起点与终点）', () => {
    const { canvas, editor } = setup();
    editor.setTool('pen');
    const init = (x: number, y: number, shift: boolean) => ({
      clientX: x,
      clientY: y,
      button: 0,
      bubbles: true,
      pointerId: 1,
      buttons: 1,
      shiftKey: shift,
    });
    canvas.dispatchEvent(new PointerEvent('pointerdown', init(20, 20, true)));
    window.dispatchEvent(new PointerEvent('pointermove', init(60, 90, true)));
    window.dispatchEvent(new PointerEvent('pointermove', init(100, 40, true)));
    window.dispatchEvent(new PointerEvent('pointerup', init(100, 40, true)));
    const [pen] = editor.getShapes();
    if (pen.type !== 'pen') throw new Error('expected pen');
    expect(pen.points).toHaveLength(2);
    expect(pen.points[0]).toEqual({ x: 20, y: 20 });
    expect(pen.points[1]).toEqual({ x: 100, y: 40 });
  });

  it('画笔未按 Shift 时保留全部手绘轨迹', () => {
    const { canvas, editor } = setup();
    editor.setTool('pen');
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 20, clientY: 20, button: 0, bubbles: true, pointerId: 1, buttons: 1 }),
    );
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 60, clientY: 90, bubbles: true, pointerId: 1, buttons: 1 }),
    );
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 100, clientY: 40, bubbles: true, pointerId: 1, buttons: 1 }),
    );
    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 100, clientY: 40, bubbles: true, pointerId: 1, buttons: 1 }),
    );
    const [pen] = editor.getShapes();
    if (pen.type !== 'pen') throw new Error('expected pen');
    expect(pen.points.length).toBeGreaterThan(2);
  });

  it('荧光笔按住 Shift 同样拖成直线', () => {
    const { canvas, editor } = setup();
    editor.setTool('marker');
    drag(canvas, [20, 20], [200, 120], true);
    const [mk] = editor.getShapes();
    if (mk.type !== 'pen') throw new Error('expected marker (pen)');
    expect(mk.points).toHaveLength(2);
  });
});
