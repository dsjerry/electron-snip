import type { MosaicMode, ToolId } from '../shared/types';

/**
 * 行 2 按工具显示的属性分组。行 2 存在的意义就是「当前工具的属性」：
 * 手型没有属性（整行隐藏）、马赛克没有颜色、文字没有线宽（字号独立）。
 */
export const ROW2_BY_TOOL: Record<ToolId, string[]> = {
  hand: [],
  arrow: ['head', 'width', 'color'],
  line: ['width', 'color'],
  rect: ['width', 'color'],
  ellipse: ['width', 'color'],
  pen: ['width', 'color'],
  marker: ['width', 'color'],
  text: ['size', 'color'],
  mosaic: ['mode'],
  counter: ['color'],
};

/**
 * 该工具 / 马赛克模式下当前是否在展示线宽控制 —— 「滚轮调线宽」共用
 * 这一份判定（编辑器据此决定要不要接管滚轮），别处别再复制这张表。
 */
export function toolUsesWidth(tool: ToolId, mosaicMode: MosaicMode): boolean {
  // 涂抹模式下线宽是笔刷半径（选区模式没有笔刷，不展示也不接管）
  return (ROW2_BY_TOOL[tool] ?? []).includes('width') || (tool === 'mosaic' && mosaicMode === 'brush');
}
