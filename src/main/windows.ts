import { screen } from 'electron';
import { openWindows } from 'get-windows';
import type { Rect } from '../shared/types';

/**
 * 枚举前台到后的应用窗口（DIP），并排除本进程自己的窗口。
 *
 * 用 get-windows 的异步版本：同步版本在 macOS 上要 ~33ms 且阻塞主进程。
 * 关掉辅助功能 / 屏幕录制检查，避免 macOS 弹出额外的权限框 ——
 * 吸附只需要 bounds 与 z 序，不需要标题与 URL。
 * Windows 返回的是物理像素，换算成 DIP；macOS 返回的已是「点」（即 DIP）。
 */
export async function listWindowRects(excludePid: number): Promise<{ owner: string; rect: Rect }[]> {
  const wins = await openWindows({ accessibilityPermission: false, screenRecordingPermission: false });
  return wins
    .filter((w) => w.owner.processId !== excludePid && w.bounds.width > 0 && w.bounds.height > 0)
    .map((w) => {
      if (process.platform !== 'win32') {
        return { owner: w.owner.name, rect: { ...w.bounds } };
      }
      const p1 = screen.screenToDipPoint({ x: w.bounds.x, y: w.bounds.y });
      const p2 = screen.screenToDipPoint({ x: w.bounds.x + w.bounds.width, y: w.bounds.y + w.bounds.height });
      return { owner: w.owner.name, rect: { x: p1.x, y: p1.y, width: p2.x - p1.x, height: p2.y - p1.y } };
    });
}
