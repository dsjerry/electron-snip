# 贡献指南 · Contributing

感谢你愿意改进 electron-snip。提交改动前请先阅读本页。

Thanks for helping improve electron-snip. Please read this before submitting changes.

## 开发环境 · Setup

- Node 24（与 Electron 43+ 的 Node 版本对齐）。
- `npm install`（`prepare` 会自动构建 `dist/`）。
- 浏览器测试需要 Chromium：`npx playwright install chromium`。

## 校验 · Checks

提交前请确保以下命令全部通过（CI 也会执行）：

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

`npm run smoke` 会启动 Electron 加载构建产物，需要本机有显示器，CI 不运行。

## 代码约定 · Conventions

- 注释使用中文，并尽量写明「为什么」和踩过的坑。
- 文件名使用 kebab-case；格式化由 Prettier 负责（单引号、分号、120 列、LF）。
- 窗口层行为（遮罩层级、抓屏时序、DPI 换算）需要在 macOS 与 Windows 实机验证，PR 里请说明验证方式。
- 改动会影响 IPC 通道时，需同时修改 `src/shared/channels.ts`、`src/preload/index.ts` 与 `src/shared/api.ts`。

## 提交信息 · Commit messages

使用 `type: 中文描述 —— 原因` 的形式，type 取 `feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `perf` 等。例如：

```
fix: 探针边距按最新帧高度计算 —— 累积高度变长后探针被推出视口
```

## 提交 PR · Pull requests

1. 从 `main` 切出分支，改动尽量聚焦一个问题。
2. 为修复或新功能补充测试；纯逻辑放在 `tests/`，DOM / canvas 放在 `tests/browser/`。
3. 同步更新 `CHANGELOG.md` 的 Unreleased 部分。
4. 在 PR 描述里说明改动动机与验证结果。

## 许可 · License

提交即表示你同意以 MIT 协议授权你的贡献。

By contributing, you agree that your contributions are licensed under the MIT License.
