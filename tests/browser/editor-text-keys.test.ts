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
  return { canvas, textEditor, editor };
}

/** 点击画布打开文字框（文字工具） */
function openText(canvas: HTMLCanvasElement, editor: Editor): HTMLTextAreaElement {
  editor.setTool('text');
  const init = { clientX: 40, clientY: 40, button: 0, bubbles: true, pointerId: 1, buttons: 1 };
  canvas.dispatchEvent(new PointerEvent('pointerdown', init));
  window.dispatchEvent(new PointerEvent('pointerup', init));
  return document.querySelector('textarea') as HTMLTextAreaElement;
}

function press(target: HTMLElement, key: string, mods: KeyboardEventInit = {}): boolean {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods });
  target.dispatchEvent(ev);
  return ev.defaultPrevented;
}

describe('文字框按键', () => {
  it('Enter 与 Shift+Enter 不被拦截，交给 textarea 换行', () => {
    const { canvas, editor } = setup();
    const ta = openText(canvas, editor);
    expect(press(ta, 'Enter')).toBe(false);
    expect(press(ta, 'Enter', { shiftKey: true })).toBe(false);
  });

  it('Ctrl+Enter 仍然提交（被拦截）', () => {
    const { canvas, editor } = setup();
    const ta = openText(canvas, editor);
    expect(press(ta, 'Enter', { ctrlKey: true })).toBe(true);
  });
});
