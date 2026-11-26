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

## Windows 多 Agent 安装、升级与卸载

要求原生 Windows、Node.js LTS 22+ 和 npm；无需 WSL 或管理员权限。使用完整 Fork 源码，在 GitHub Desktop 切换到 `feat/software-design-rules` 分支并 Pull 后操作。三脚本默认不打开浏览器。

| 脚本 | 行为 |
|---|---|
| install.bat | 展示 Agent 菜单与安装状态，输入编号（如 1,8）、名称（如 codex,dsh）或 all，安装选中的 Agent。选中已登记项时更新该项。 |
| reinstall.bat | 自动识别本机登记及有效所有权标记、旧版默认 Codex 安装，全量重装/升级；缺失的已登记目录会恢复。不自动 Pull 源码。 |
| uninstall.bat | 自动列出全部已管理 Agent，确认后删除其完整 Skill、依赖和新版管理器备份；保留其他 Skill、业务项目及共享浏览器。 |

支持标准全局目录（~ 代表 USERPROFILE；每个目录下安装 visual-explainer 文件夹）：

| ID | Agent | Skill 根目录 |
|---|---|---|
| codex | Codex App / CLI | ~/.agents/skills |
| cursor | Cursor | ~/.cursor/skills |
| claude | Claude Code | ~/.claude/skills |
| opencode | OpenCode | ~/.config/opencode/skills |
| cline | Cline | ~/.cline/skills |
| pi | Pi | ~/.pi/agent/skills |
| copilot | GitHub Copilot | ~/.copilot/skills |
| dsh | DeepSeek Harness | ~/.dsh/skills |
| antigravity | Antigravity App / CLI | ~/.gemini/config/skills |

这些是当前文档约定的默认本地目录；宿主自定义 home/config、项目内 Skill、远程环境和 marketplace/package 安装不由此工具管理。特别是 DSH_HOME 等自定义路径需要按宿主配置调整，不能假定默认目录会被读取。Cursor、OpenCode、DSH、Pi、Copilot 等可能发现共享目录中的同名 Skill，因此选择安装控制实际写入目录，而非限制其他 Agent 的发现权限。宿主的图片展示和快捷命令仍以实际版本为准。参考 [Cursor](https://cursor.com/docs/skills)、[OpenCode](https://opencode.ai/docs/skills/)、[DSH](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.zh.md)、[Antigravity](https://antigravity.google/docs/skills)、[VS Code](https://code.visualstudio.com/docs/agent-customization/agent-skills)、[Cline](https://github.com/cline/skills)。

非交互调用示例（PowerShell，在仓库根目录）：

```powershell
.\install.bat -Agents "codex,dsh,cursor" -NoPause
.\install.bat -All -NoPause
.\reinstall.bat -NoPause
.\uninstall.bat -Yes -NoPause
.\install.bat -List -NoPause
```

登记文件：%USERPROFILE%\.visual-explainer-manager\installations.json。每份受管理 Skill 有独立所有权标记；登记丢失时可恢复标记，有成功旧版安装回执的默认 Codex 安装可自动接管。每次安装/重装只调用原 Windows 安装器一次，安装浏览器依赖、生成示例并在真实 Chromium 验证，通过后复制到选中目录并验证每个副本。替换前备份，失败恢复旧版本；逐 Agent 记录成功或失败，失败项返回非零退出码。已有未登记同名 Skill 会提示冲突并保留，拒绝覆盖或卸载；不会跟随文件系统链接。请关闭相关 Agent 后运行，结束后重启。

新版备份和构建日志位于管理器目录。卸载清除受管理的有效安装、对应新版备份和登记；全部卸载后清理新版暂存与示例，留下空登记以供再次安装。旧安装器的历史备份、旧安装示例和首次接管旧版时的备份保留在发现目录之外（其中可能有用户定制）；共享 Chromium 缓存和 Node.js 不删除。手工/第三方安装不自动删除。安装器需要 Node.js；卸载无需 npm 下载或联网，但也需要 Node.js 执行。发生异常退出而遗留 operation.lock 时，确认没有安装进程后再手动移除锁文件。

高级测试使用 -ProfileRoot 指定隔离的用户目录，并在三个脚本中使用相同路径。旧版 -AgentHome 参数保留用于原单目标安装器回归及自定义单独安装，不加入新管理登记。

日常在 Agent 中使用：要求使用 visual-explainer Skill 生成软件方案。Codex 仍可输入：

```text
$visual-explainer 方案：在这里填写本次需求。
```

六条表达规范、五项设计规则、精简/完整视图和对话预览继续生效。

现状业务梳理、前后台处理、状态机和目标方案统一使用增强软件方案模式。新版在精简/完整模板中提供 businessFlow 规范场景，校验入口、角色、条件、步骤、独立状态对象及结果；流程图由 flow 命令生成，时序/状态图与业务模型交叉检查。新增 deliver 门禁，要求当前模型、HTML 和检查报告一致，拒绝普通 HTML 或人工改写的产物。老模型仍能渲染，新标准交付须补充业务场景。结构校验不等同于真实业务验收。

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
