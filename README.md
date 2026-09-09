# DeepSeek Harness Desktop

> 一键启动 [dsh](https://www.npmjs.com/package/@deepseek-ai/dsh)（DeepSeek Harness），并把它的 Web UI 以独立桌面应用窗口呈现的 Electron 外壳，附带动效精美的 Windows 安装程序。

## 特性

- **一键启动**：后台以隐藏窗口方式运行 `dsh web`（无命令行黑框），自动解析带鉴权 token 的本地地址（随机端口，避免冲突）并在桌面窗口中加载。
- **同生共死**：dsh 进程退出时桌面窗口自动关闭；退出应用时通过 `taskkill /T /F` 清理整个子进程树，不留后台残留。
- **图形化安装向导**：可自定义安装路径，自动创建桌面与开始菜单快捷方式。
- **可选一键装环境**：安装程序可自动通过 npm 全局安装 dsh，并可选安装插件商店 [dshmarket](https://www.npmjs.com/package/dshmarket) 与 [DeepSeek Balance Whale Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)；默认走国内镜像，GitHub 资源自动镜像回退。
- **卸载可选联动**：卸载时可选择是否一并移除全局安装的 dsh（默认只移除外壳，保护共享环境）。

## 这个项目是什么（重要）

本项目**只是一个桌面外壳**：本身不包含 dsh 及其 Web UI，只负责启动 dsh 子进程并用窗口承载其页面。

安装程序组件页中的三个组件全部可选：

| 组件 | 实际执行 | 依赖 |
| --- | --- | --- |
| **DeepSeek Harness** | `npm install -g @deepseek-ai/dsh` | Node.js / npm |
| **插件商店 dshmarket** | `dsh plugin --profile web add dshmarket` | dsh |
| **DeepSeek Balance Whale Widget** | `dsh plugin --profile web add github:MeteorNOX/DeepSeek-Balance-Whale-Widget` | dsh |

- 三项都不勾选：仅安装桌面外壳，你需要自行安装 dsh，否则应用启动时会弹窗提示。
- 只勾选插件但系统中没有 dsh：安装程序会自动先安装 dsh 作为依赖。
- 检测到已安装 dsh 时跳过安装；插件已存在时视为成功，安装程序可安全重复运行。
- Node.js / npm 缺失且勾选了需要它们的组件时，安装程序会提示先安装 [Node.js LTS](https://nodejs.org/)。

## 安装向导

页面顺序：欢迎 → 安装用户（所有用户 / 仅我）→ 选择组件 → 安装位置 → 安装过程 → 完成。

- 组件页标题为“选择组件”，三项均为可勾选复选框（默认勾选前两项）。
- dsh 安装默认使用 [npmmirror 镜像](https://npmmirror.com/)，失败再回退官方 npm 源。
- Whale Widget 从 GitHub 安装，直连失败时自动通过 gh-proxy 镜像重试。
- 安装/卸载日志写入 `%TEMP%\dsh-desktop-setup.log`，组件安装失败不会阻止外壳安装完成。

卸载向导第一页为“卸载选项”：勾选后才会执行 `npm uninstall -g @deepseek-ai/dsh`；静默卸载（`/S`）永远不会删除全局 dsh。

## 使用

安装后双击桌面快捷方式（或开始菜单中的 **DeepSeek Harness**）即可。应用会：

1. 隐藏窗口启动 `dsh web --no-open --port 0`；
2. 从输出中解析带 token 的 URL 并轮询等待服务就绪；
3. 加载 Web UI（加载期间显示浅色主题启动页）；
4. 关闭窗口即结束整个 dsh 进程树。

## 开发

环境要求：Node.js 18+（推荐 20/22 LTS）、Windows。

```powershell
git clone https://github.com/SmailPang/DeepSeek-Harness-Desktop.git
cd DeepSeek-Harness-Desktop
npm install
npm start
```

`npm install` 的 postinstall 会运行 `installer/patch-electron-builder.js`，对 electron-builder 的 NSIS 模板做**幂等补丁**（在“安装用户”和“安装位置”页面之间插入自定义组件页钩子）。补丁只影响本地 `node_modules`，重复执行安全。

## 打包

```powershell
npm run dist
```

产物为 `dist/DeepSeek-Harness-Setup-<版本>.exe`（NSIS 安装程序）。

国内网络下可通过 `.npmrc` 或环境变量使用镜像：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist
```

## 项目结构

```
main.js                    Electron 主进程：子进程托管、URL 解析、窗口、生命周期
loading.html               浅色主题启动等待页
assets/                    应用图标与安装向导侧边图
installer/
  setup.nsh                NSIS 自定义页面（组件选择 / 卸载选项）与安装段逻辑
  postinstall.ps1          安装阶段：检测 Node、安装 dsh 与插件（镜像/回退）
  uninstall-dsh.ps1        卸载阶段：按需移除全局 dsh
  patch-electron-builder.js  幂等补丁 electron-builder NSIS 模板
.github/workflows/release.yml  发布 Release 时自动构建 Windows 安装包
```

## 使用与致谢

本项目站在以下开源项目的肩膀上：

- [Electron](https://www.electronjs.org/) — 桌面窗口框架（MIT）
- [electron-builder](https://www.electron.build/) — Windows NSIS 安装包打包工具（MIT）
- [DeepSeek Harness (dsh)](https://www.npmjs.com/package/@deepseek-ai/dsh) — 本外壳所启动的命令行工具及其 Web UI（`@deepseek-ai/dsh`）
- [dshmarket](https://www.npmjs.com/package/dshmarket) — dsh 插件商店
- [DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) — 可选安装的余额鲸挂件，作者 [MeteorNOX](https://github.com/MeteorNOX)
- [npmmirror](https://npmmirror.com/) / [gh-proxy](https://gh-proxy.com/) — 国内网络加速与 GitHub 镜像

## License

[MIT](LICENSE)
