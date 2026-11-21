// 与 Electron 无关的小工具：主进程与渲染页面共用，子路径导出，渲染侧不会拉进 electron。
export { toBlob, toClamped } from '../shared/bytes';
export { pointInRect } from '../shared/selection';
export { cropShot, type RgbaFrame } from '../shared/crop';
