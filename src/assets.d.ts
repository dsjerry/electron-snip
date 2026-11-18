// 构建期资源声明：SVG 以文本导入（tsup 的 text loader），内联进包；
// CSS 作为副作用导入，由打包器合并进渲染资源。
declare module '*.svg' {
  const svg: string;
  export default svg;
}

declare module '*.css';
