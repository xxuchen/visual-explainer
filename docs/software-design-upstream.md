# 软件方案扩展与上游升级

本 Fork 在 Visual Explainer v0.15.0 上增加可选软件方案模式。基线：`nicobailon/visual-explainer` 的 `9d5f880b7e8e0a9a80c890b8e1bb6918b68481ad`。

## 改动边界

唯一修改的上游既有文件是 `plugins/visual-explainer/SKILL.md`，新增一个模式入口段落。新功能独立放在以下位置：

- `plugins/visual-explainer/software-design/`：模型、验证、SVG/HTML、命令和测试。
- `plugins/visual-explainer/references/software-design.md`：五项规则和使用流程。
- `plugins/visual-explainer/commands/generate-software-design.md`：可选命令入口。
- `plugins/visual-explainer/templates/software-design.json`：可编辑示例。
- `scripts/check-software-design.mjs`、`.github/workflows/software-design.yml`：扩展及兼容性检查。
- `install.bat`、`scripts/install-windows.ps1`：独立的 Windows 安装入口与实现；`scripts/check-windows-install.ps1` 验证安装、升级和失败保护。

上游 `kit/`、`plan/`、MCP、Pi、默认命令、版本号和 package.json 均保持原样。扩展随现有 canonical skill 文件夹一起复制和打包；不依赖另一个全局 skill，也不拷贝一份上游运行时代码。

## 兼容接口

`software-design/upstream.mjs` 是唯一接触上游实现 API 的文件，仅调用 `kit/render.mjs` 的 `renderPage(source, {models:false})` 和 `prepareRenderedHtml(html)`。它保留 kit 内联资源与评论/回复交互，在此模式中移除已知 Google Fonts 链接，并添加离线内容策略；普通 kit 页面继续采用原有行为。

上游 API 不是稳定公开协议。适配器形状检查、离线扫描、原项目检查和扩展契约测试共同提供升级信号；未来仍可能需要调整此适配器或入口段落。HTML 不依赖外网呈现，系统字体字形与细微排版可能随操作系统变化。

此版本仅增加文件系统 CLI/命令提示，不增加专用 MCP 工具或 Pi tool 名称。支持加载该 skill 并执行 Node 的 agent 可使用完整流程。宿主是否自动发现 slash 命令取决于现有插件集成；直接要求 agent 读取 `references/software-design.md` 同样可用。

## Windows 自动安装

使用完整仓库，安装入口位于根目录 `install.bat`。合并本 PR 前，在 GitHub Desktop 中切换到 `feat/software-design-rules`，点击 **Fetch origin / Pull origin**。例如仓库在 `D:\agent-tools\visual-explainer`，双击其中的 `install.bat`，或在 PowerShell 执行：

```powershell
& 'D:\agent-tools\visual-explainer\install.bat'
```

前置环境：Windows、Node.js 22 或更高版本及随附的 npm。可从 [Node.js 官方下载页](https://nodejs.org/en/download) 安装受支持的 LTS 版本；安装后重新打开终端。脚本使用 Windows 自带的 PowerShell 5.1，支持从 PowerShell 7 启动；缺少运行环境时会给出具体提示。使用实际运行 Codex 的 Windows 用户执行，无需管理员权限或 WSL。

安装过程会检查增强文件是否齐全，复制整个 `plugins/visual-explainer`，按照仓库 `package.json` 中的版本范围安装 `playwright-core` 和匹配的 Chromium，再生成中文示例并执行真实浏览器检查。验证通过后才启用新 Skill；已有安装移至备份目录。安装失败会保留原安装，激活失败会尝试恢复备份，并输出日志路径。

| 内容 | 默认位置 |
| --- | --- |
| Codex Skill | `%USERPROFILE%\.agents\skills\visual-explainer` |
| 旧版本备份 | `%USERPROFILE%\.agents\skill-backups\` |
| 安装日志、示例 HTML、检查报告和截图 | `%USERPROFILE%\.agents\visual-explainer-output\` 下本次运行目录 |

每次更新源码后重新运行 `install.bat` 即可更新安装。示例业务验收保留 `not-run`，浏览器检查仅验证生成页面；实际项目仍需填入真实方案并执行对应验收。安装完成后，在 Codex 新对话中输入：

```text
$visual-explainer 方案：在这里填写本次需求。
```

软件方案模式默认读取当前业务项目，按六条表达规范（结论优先、证据分离、信息唯一、图文互补、增量表达、决策导向）与五项设计规则生成精简评审 HTML、可编辑 JSON 和检查报告。默认只展示必要结论，无最低字数，正文最多 800 非空白字符；证据和追踪关系保存在模型与检查报告。执行结构、重复长句提示、静态页面和浏览器检查，Agent 复核语义重复。需要完整技术视图时输入 `$visual-explainer 完整技术方案：具体需求`。默认工作范围为方案设计，聊天只返回简短结论、关键待确认事项、验证摘要和文件位置。需要调整时，在需求后补充新的目录、范围或输出要求即可。

自动化环境可以关闭结束暂停和自动打开示例，并指定隔离的安装根目录：

```powershell
.\install.bat -NoPause -NoOpen -AgentHome 'D:\temporary-agent-home'
```

`-AgentHome` 下仍采用 `skills\visual-explainer`、`skill-backups`、`visual-explainer-output` 布局。日常 Codex 使用默认路径即可。备份中的自定义文件保留在旧版本内，新安装以当前仓库源码为准；需要保留的规则应先提交到自己的 Fork。该安装入口面向 Codex Skill 与软件方案流程，其他宿主仍使用其原有集成入口。

## 合并上游

在自己的 clone 中配置一次 `upstream`，每次升级在独立分支做普通 merge。保留扩展的独立提交，便于回退和审查。

```bash
git remote add upstream https://github.com/nicobailon/visual-explainer.git
git fetch upstream
git switch main
git pull --ff-only origin main
git switch -c chore/sync-upstream-YYYY-MM-DD
git merge upstream/main
```

若已配置 upstream，跳过 add。遇到 `SKILL.md` 冲突，保留上游正文，再保留本扩展的模式入口段落。不要自动采用整文件的 ours/theirs 处理冲突。随后执行：

```bash
node scripts/check-versions.mjs
node scripts/check-kit.mjs
node scripts/check-machine.mjs
node scripts/check-ask.mjs
node scripts/check-software-design.mjs
```

重生成模板页面并做浏览器检查：

```bash
node plugins/visual-explainer/software-design/cli.mjs render plugins/visual-explainer/templates/software-design.json --out output/software-design.html --require-browser
```

Windows 下直接运行以上 Node 命令。复制安装时复制整个 `plugins/visual-explainer/`，避免依赖根目录的 `skills/visual-explainer` 符号链接。CI 在 Linux 跑上游和扩展检查，在 Windows 跑扩展检查；另设真实浏览器任务。首次在 Fork 启用 Actions 可能需要仓库所有者按 GitHub 页面提示操作。

检查通过后创建指向自己 Fork main 的升级 PR。这样官方代码变更与本地规则变更可以分别评审。

## 版本与数据

扩展输入格式以 `schemaVersion: 1` 单独版本化，不改官方版本号。未来字段语义发生不兼容变化时增加输入版本及显式迁移，不静默改写已有设计。设计 JSON 的 ID 保持稳定；回执绑定内容摘要（排除 verification 字段），实质修改方案后需重新执行相关验收。

证据记录绑定方案和日志；它不签名、不自动证明业务测试覆盖充分，也不自动检测被测代码或环境是否已变化。实施代码/环境/依赖变更后应重跑测试，正式项目可用受信任 CI 产出并保留回执。
