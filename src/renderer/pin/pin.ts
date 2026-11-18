import './pin.css';
import '../../annotations/annotations.css';
import { stitch } from '../../shared/stitch';
import { drawShape } from '../../annotations/shapes';
import { Editor } from '../../annotations/editor';
import { createToolbar } from '../../annotations/toolbar';
import { toBlob } from '../../shared/bytes';
import type { PinBootPayload, Shape } from '../../shared/types';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const closeBtn = document.getElementById('close') as HTMLButtonElement;
const editBtn = document.getElementById('edit') as HTMLButtonElement;
const toolbarEl = document.getElementById('pin-toolbar') as HTMLDivElement;
const textEditorEl = document.getElementById('text-editor') as HTMLTextAreaElement;
const ctxOrNull = canvas.getContext('2d');
if (!ctxOrNull) throw new Error('无法创建 canvas 2d 上下文');
// 函数声明会在检查之前被调用，收窄不会传进去 —— 这里显式给一个非空类型
const ctx: CanvasRenderingContext2D = ctxOrNull;

/**
 * 贴图窗口：
 * - 滚轮缩放（窗口随缩放，光标下的点不动）；Ctrl+滚轮 调不透明度；
 * - 双击复制；Ctrl+T 切换鼠标点击穿透；Esc 关闭（编辑中先退编辑）；
 * - ✎ 进入标注编辑模式（Editor + 工具条浮在图上），导出含新标注。
 */

let base: HTMLCanvasElement | null = null;
let initialShapes: Shape[] = [];
let editor: Editor | null = null;
let editMode = false;
/** 累计缩放倍数（相对初始尺寸），用于钳制滚轮缩放范围 */
let zoomTotal = 1;

function repaint(): void {
  if (!base) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(base, 0, 0);
  for (const shape of initialShapes) drawShape(ctx, shape);
  editor?.renderInto(ctx);
}

async function exportPng(): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('导出 PNG 失败');
  return new Uint8Array(await blob.arrayBuffer());
}

function copy(): void {
  void exportPng()
    .then((png) => window.snip.pin.action({ kind: 'copy', png }))
    .catch((err: unknown) => console.error('[pin] 复制失败', err));
}

// ---------------------------------------------------------------- 编辑模式

function enterEdit(): void {
  if (!base || editMode) return;
  editMode = true;
  document.body.classList.add('editing');
  editBtn.classList.add('is-active');
  if (!editor) {
    editor = new Editor(canvas, textEditorEl, {
      // 贴图画布 backing = 图像像素（与遮罩不同，不随窗口缩放）
      repaint,
      coords: 'backing',
    });
    createToolbar(toolbarEl, editor, {
      actions: [
        {
          id: 'done',
          label: '完成',
          primary: true,
          run: () => exitEdit(),
        },
      ],
    });
  }
  toolbarEl.hidden = false;
}

function exitEdit(): void {
  if (!editMode) return;
  editMode = false;
  document.body.classList.remove('editing');
  editBtn.classList.remove('is-active');
  toolbarEl.hidden = true;
}

editBtn.addEventListener('click', () => (editMode ? exitEdit() : enterEdit()));

// ---------------------------------------------------------------- 滚轮 / 双击 / 穿透

window.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+滚轮：贴图不透明度（mac 用户习惯 Cmd）
      void window.snip.pin.action({
        kind: 'opacity',
        delta: e.deltaY < 0 ? 0.1 : -0.1,
      });
      return;
    }
    let f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    if (zoomTotal * f > 8) f = 8 / zoomTotal;
    if (zoomTotal * f < 0.2) f = 0.2 / zoomTotal;
    if (Math.abs(f - 1) < 0.01) return;
    zoomTotal *= f;
    void window.snip.pin.action({ kind: 'zoom', factor: f });
  },
  { passive: false },
);

window.addEventListener('dblclick', () => {
  if (editMode) return;
  copy();
});

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLTextAreaElement) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 't') {
    // 切换鼠标点击穿透；穿透后本窗口点不到，需要再按一次才能恢复
    event.preventDefault();
    void window.snip.pin.action({ kind: 'ignore' });
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    if (editMode) exitEdit();
    else void window.snip.pin.action({ kind: 'close' });
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
    event.preventDefault();
    copy();
  }
});

async function main(): Promise<void> {
  const payload: PinBootPayload | null = await window.snip.pin.boot();
  if (!payload) {
    console.warn('[pin] boot 返回 null');
    return;
  }
  if (payload.kind === 'image') {
    // 独立图片：直接铺成底图，没有阴影留白、没有遮罩阶段的标注
    const bmp = await createImageBitmap(toBlob(payload.png, 'image/png'));
    base = document.createElement('canvas');
    base.width = bmp.width;
    base.height = bmp.height;
    base.getContext('2d')?.drawImage(bmp, 0, 0);
    bmp.close();
    initialShapes = [];
  } else {
    console.log(
      `[pin] boot ok selection=${Math.round(payload.selection.width)}x${Math.round(payload.selection.height)}` +
        ` outScale=${payload.outScale} shapes=${payload.initialShapes.length}` +
        ` pad=${JSON.stringify(payload.padding)}`,
    );
    // 四边阴影留白：主进程算的，渲染进程只负责让开画布位置（pin.css 用它做 calc）
    const pad = payload.padding;
    const vars = document.documentElement.style;
    vars.setProperty('--pad-top', `${pad.top}px`);
    vars.setProperty('--pad-right', `${pad.right}px`);
    vars.setProperty('--pad-bottom', `${pad.bottom}px`);
    vars.setProperty('--pad-left', `${pad.left}px`);

    base = await stitch(payload);
    console.log(`[pin] 拼接完成 ${base.width}x${base.height}`);
    initialShapes = payload.initialShapes;
  }

  // 画布 backing store = 图像像素（固定不变）；CSS 尺寸随窗口缩放，
  // devicePixelRatio 完全不参与换算，拖到别的 DPI 的屏上也不会错位。
  canvas.width = base.width;
  canvas.height = base.height;
  repaint();

  if (payload.kind === 'image' && payload.editMode) enterEdit();

  closeBtn.addEventListener('click', () => {
    void window.snip.pin.action({ kind: 'close' });
  });

  // 主进程收到 ready 后才会收起遮罩并显示本窗口（同 tick，不闪白）
  await window.snip.pin.ready({ width: canvas.width, height: canvas.height });
  console.log('[pin] ready 已发送');
}

void main().catch((err) => {
  console.error('[pin] 初始化失败', err);
});
