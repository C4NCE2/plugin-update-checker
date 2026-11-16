# plugin-update-checker 产品设计文档

日期:2026-11-13
状态:已与用户对齐方案(产品形态 = Claude Code 插件,经自有 marketplace 仓库分发)

## 1. 背景与问题

Claude Code CLI 内置了启动时的 "Plugin autoupdate" 后台流程,但在以下场景不工作(已通过对本机 2.1.152 / 2.1.323 二进制取证确认):

1. 用户设置了 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` 或关闭 autoUpdater(常见于代理/中转网络环境);
2. 主要通过 VSCode 扩展面板使用 Claude Code(autoupdate 挂在交互式 CLI 启动路径上);
3. 插件来自第三方 marketplace(官方流程默认只自动更新官方 marketplace)。

实证:本机 4 个插件与 marketplace 缓存自 2026 年 5-6 月起近 5 个月无人刷新,尽管机器每天在用。

## 2. 产品定位

**一句话**:装上它,你的 Claude Code 会在每次会话启动时替你盯着所有已装插件的更新,发现新版本就提醒,并给出可直接执行的更新命令。

- 产品本身是一个 Claude Code 插件,通过产品自己的 GitHub 仓库(即一个 marketplace)分发。
- 任意机器两条命令接入(`<owner>` 为发布时确定的 GitHub 用户名,默认 `yangzhuocheng`):
  ```
  /plugin marketplace add <owner>/plugin-update-checker
  /plugin install update-checker@plugin-update-checker
  ```
- 零配置:运行时读取该机器自己的 `~/.claude/plugins/` 状态文件,自动发现该机器装了哪些插件、注册了哪些 marketplace。
- 行为模式:**提醒 + 一键更新**(用户已确认,不做静默自动更新)。"一键" = 提醒中附现成命令,且通过 additionalContext 让会话内的 Claude 能直接代跑。
- 自举:产品自己的 marketplace 安装后同样出现在 known_marketplaces.json 中,被同一套逻辑检查,产品会提醒"我自己有更新"。

## 3. v1 非目标(YAGNI)

- 不做配置文件/自定义 TTL(固定 24h)
- 不做静默自动更新
- 不检查 VSCode 扩展更新(VSCode 自带)
- 不检测"插件已从 marketplace 下架"(条目消失时跳过,留待未来)
- 不做非 git 源的 marketplace(本地目录源等,跳过)
- 不做任何 UI
- 提醒文案 v1 仅中文(i18n 留待未来)

## 4. 仓库结构

```
plugin-update-checker/               ← GitHub 仓库 = marketplace
├── .claude-plugin/
│   └── marketplace.json             ← marketplace 清单
├── plugins/update-checker/
│   ├── .claude-plugin/plugin.json   ← 插件清单
│   ├── hooks/hooks.json             ← SessionStart hook 注册
│   ├── scripts/check-updates.mjs    ← 核心逻辑(零依赖 Node,纯模块无副作用,供测试导入)
│   ├── scripts/hook-entry.mjs       ← hook 入口薄壳(调用 run(),恒 exit 0)
│   └── tests/check-updates.test.mjs ← 单元 + 集成测试(node:test)
├── README.md                        ← 英文为主 + 中文简介
└── LICENSE
```

### 4.1 marketplace.json(产品仓库根)

```json
{
  "name": "plugin-update-checker",
  "owner": { "name": "yangzhuocheng" },
  "plugins": [
    {
      "name": "update-checker",
      "source": "./plugins/update-checker",
      "description": "Reminds you about available updates for all installed Claude Code plugins at session start.",
      "category": "productivity"
    }
  ]
}
```

### 4.2 plugin.json

```json
{
  "name": "update-checker",
  "version": "0.1.0",
  "description": "Session-start update reminders for all installed Claude Code plugins.",
  "author": { "name": "yangzhuocheng" }
}
```

### 4.3 hooks/hooks.json

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hook-entry.mjs\""
          }
        ]
      }
    ]
  }
}
```

## 5. 运行时流程

SessionStart 触发 → `node check-updates.mjs`:

1. **发现**:读取 `$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json` 与 `known_marketplaces.json`(未设 `CLAUDE_CONFIG_DIR` 时用 `~/.claude`)。任一文件不存在、解析失败、或无已装插件 → 静默退出(exit 0,无输出)。
2. **节流刷新**:对 known_marketplaces.json 中每个 `installLocation` 存在且是 git 仓库的 marketplace:若 `state.json` 中记录的该 marketplace 上次成功刷新时间距今 > 24h,执行 `git -C <installLocation> pull --ff-only`(单仓库超时 8s,全局预算见 §7)。成功则更新时间戳;失败保留旧缓存并记录失败时间。
3. **比对**(纯本地):读各 marketplace 的 `.claude-plugin/marketplace.json`,对每个已装插件 `name@marketplace` 按其 marketplace 中的同名条目比对(规则见 §6)。
4. **输出**:
   - 有更新 → stdout 输出单个 JSON(见 §8),exit 0。
   - 无更新 → 无输出,exit 0。
   - 有更新未处理时,每次会话启动都重复提醒(nag until updated,产品职责)。

## 6. 比对规则

输入两侧(真实形态见附录 A):

- 已装侧 `installed_plugins.json`:`plugins["name@marketplace"]` 是**数组**(多 scope),每条含 `version`、`gitCommitSha`。v1 取数组首条比对;同一插件多 scope 时提醒去重(按 `name@marketplace`)。
- marketplace 侧条目三种形态:
  - **a. 外部 url 源**:`source` 为对象 `{ "source": "url", "url": ..., "sha": <完整commit sha> }`(如 superpowers)
  - **b. 仓库内置 + 带 version**:`source` 为相对路径字符串,条目带 `version` 字段(如 swift-lsp)
  - **c. 仓库内置 + 无 version**:`source` 为路径字符串、无 version 字段。此时 Claude Code 安装时会把已装 `version` 记成**截断 sha**(本机实例:document-skills 的 `da20c92503b2`),且已装 `gitCommitSha` 就是安装时 marketplace 仓库的 commit

规则(按序判定,命中即停):

1. marketplace 中找不到同名条目 → 跳过(不提醒,不报错)。
2. 形态 a:条目 `source.sha` 与已装 `gitCommitSha` **全等** → 最新;不等 → 有更新。(已知限制:若上游条目使用截断 sha 而已装侧为完整 sha,全等比较会持续报有更新;附录 A 取证真实数据两侧均为完整 sha,接受此风险。条目 `sha` 为空串视同"无 sha",走 skip,不误报更新。)
3. 形态 b:条目 `version` 与已装 `version` **字符串相等** → 最新;不等 → 有更新。(不做 semver 排序,marketplace 即"最新"的事实来源。若已装 version 是 sha 回退值而与条目 version 不等,判为有更新——至多多提醒一次,执行更新后自愈。已装 `version` 缺失或非字符串时不按本规则字面判更新,降级走形态 c 的 repo-check 判定,行为更精确。)
4. 形态 c:执行 `git -C <marketplace仓库> diff --quiet <已装gitCommitSha> HEAD -- <条目source路径>`,退出码 0(无差异)→ 最新;1(有差异)→ 有更新;已装 sha 缺失或已不在仓库历史中 → 跳过。**纯本地 git 操作,不产生网络流量。**

提醒中展示:插件名、已装版本(截断 sha 显示前 12 位)、marketplace 名、更新命令。目标版本的显示规则:形态 b 显示新版本号;形态 a/c 显示新 sha 前 12 位或"内容有更新"。

**"已跟上"判定(dogfood 实证修复,2026-11-16,第二版)**:Claude Code 的 `plugin update` 对 url 源插件可能不回写 `gitCommitSha`(2.1.152/2.1.325 实测:superpowers 5.1.0→7.0.2 后 sha 仍为旧值,新缓存目录无 .git;已最新时重跑 update 在本机因 EBUSY 失败且不重写记录),导致 sha 系形态(a/c)在正当更新后误报。第一版"提醒指纹"方案对"产品部署前已完成的更新"无效(首条指纹即更新后状态),故弃用,改为**更新新近性判定**——纯本地 git 历史信号,不依赖 state、不依赖 update 命令行为:

- 形态 a:用 pickaxe 查 pin sha 写入 marketplace 清单的提交日期 `D = git log -1 --format=%cI -S"<entry.sha>" -- .claude-plugin/marketplace.json`;若 `rec.lastUpdated > D` → 用户的更新发生在该 pin 成为目标之后,视为已跟上(current),否则提醒。
- 形态 c:查插件子目录最后变更日期 `D = git log -1 --format=%cI -- <subPath>`;若 `rec.lastUpdated > D` → 已跟上,否则提醒。
- 形态 b:version 比较天然自愈,不参与。
- D 查不到/时间戳无效/预算不足 → 保守提醒(nag 语义保留:未更新则每次提醒)。

真机实证:superpowers pin 22f0b46 引入于 2026-11-12,用户更新发生于 2026-11-16 → 判定已跟上,误报消除。

## 7. 时间与失败预算

- 全脚本总预算 **10 秒**:超时立即停止后续 git pull;比对阶段的规则 4 本地 git diff 同样受预算约束,剩余预算不足 500ms 时跳过该项判定(视为无法判定),只用已有缓存完成比对输出。
- 单仓库 `git pull` 超时 8s;所有 git 子进程一律强制非交互(`GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=never`、`GIT_SSH_COMMAND="ssh -oBatchMode=yes"`),杜绝会话启动时的凭据弹窗或挂起。
- 本地比对路径(无刷新需要时)目标 < 100ms。
- **任何内部错误都不得冒泡**:hook 永远 exit 0;不向 stderr 输出(避免会话启动 UI 出现错误噪音)。
- 调试:`UPDATE_CHECKER_DEBUG=1` 时把运行日志追加写入 state 目录下 `debug.log`。

## 8. Hook 输出契约

```json
{
  "systemMessage": "🔄 2 个 Claude Code 插件有更新:\n  • superpowers 5.1.0 → f2cbfbefebbf (claude-plugins-official)\n  • andrej-karpathy-skills 1.0.0 → 1.1.0 (karpathy-skills)\n更新命令:\n  claude plugin update superpowers@claude-plugins-official\n  claude plugin update andrej-karpathy-skills@karpathy-skills\n更新后重启会话或运行 /reload-plugins 生效。",
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "[update-checker] 有 2 个插件可更新:superpowers@claude-plugins-official、andrej-karpathy-skills@karpathy-skills。用户要求更新时,逐条执行 claude plugin update <name@marketplace>,并提醒更新后需重启会话或运行 /reload-plugins。"
  }
}
```

- `systemMessage` 面向用户;`additionalContext` 面向会话内 Claude,支撑"会话里说一句就帮我更新"的一键体验。
- 若某 marketplace 刷新失败导致缓存过期 > 48h,systemMessage 末尾附注:`(注:<marketplace> 版本信息已过期 N 天,可能不准)`。
- `claude plugin update` 需要重启生效(二进制取证:"restart required to apply";2.1.323 支持 `/reload-plugins`),文案必须带上这一点。

## 9. 状态文件

路径:`~/.claude/plugins/data/update-checker/state.json`(目录不存在则创建;不可写则降级为跳过刷新、仅本地比对)。

```json
{
  "lastRefresh": { "claude-plugins-official": "2026-11-13T08:00:00.000Z" },
  "lastFailure": { "karpathy-skills": "2026-11-13T08:00:05.000Z" }
}
```

健壮性:state 顶层与两个嵌套字段均做"非 plain object 即视为空对象"守卫(损坏的标量/数组不得引发属性赋值 TypeError);state 损坏时降级并在下次运行自愈重写。历史版本遗留的 reminded 字段不再使用(读出后原样保留,无副作用)。

## 10. 关键技术决策与理由

| 决策 | 选择 | 理由 |
|---|---|---|
| 语言 | Node ≥18,ESM,零依赖 | Claude Code 用户机器几乎必有 node;免安装步骤 |
| 刷新方式 | 直接 `git pull --ff-only` | 会话内再拉起 claude CLI 有递归/启动开销风险;流量只去 git remote(GitHub),不触碰 Anthropic 端点,不与 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` 冲突 |
| `--ff-only` | 强制快进 | marketplace 缓存若被本地改动,拒绝合并、按失败处理,避免产生奇怪状态 |
| 状态存放 | 插件 data 目录 | 插件升级不清除;不污染用户 settings.json |
| 平台 | Windows cmd 与 Unix sh 同一命令行 | `node "${CLAUDE_PLUGIN_ROOT}/..."` 引号写法两侧兼容;dogfood 阶段在 Windows+VSCode 实测 |

## 11. 隐私与网络行为(产品卖点,写入 README)

- 只读本机 `~/.claude/plugins/` 下已有文件;
- 网络请求仅限该机器已注册 marketplace 的 git remote(每 24h 至多一次);
- 不访问 Anthropic 任何端点,不上报任何数据。

## 12. 测试策略

**单元测试**(node:test,fixtures 取本机真实文件形态,含 sha 版本号、url 源、多 scope 数组等坑):

- `comparePlugin(installedEntry, marketplaceEntry)`(规则 1-3,纯函数)→ 全分支:sha 等/不等、version 等/不等、条目缺失、字段缺失、version 为 sha 回退值
- 规则 4 `repoPluginChanged(repoDir, sha, subPath)` → 集成测试:测试内构造临时 git 仓库(两次 commit 改动/不改动插件子目录各一),验证判定正确、sha 不在历史时安全跳过
- `buildOutput(results)` → systemMessage/additionalContext 文案与 JSON 结构
- 节流判断 `needsRefresh(state, name, now, ttl)` → 边界(恰好 24h、state 缺失、state 损坏)

**本机 dogfood 矩阵**(Windows + VSCode 扩展为主,CLI 为辅):

| 场景 | 期望 |
|---|---|
| 本地目录方式安装产品后启动会话 | hook 触发,`${CLAUDE_PLUGIN_ROOT}` 正确展开 |
| 存在过期插件(当前机器真实状态即样本) | systemMessage 在 VSCode 面板可见,命令可复制执行 |
| 全部最新 | 无任何输出 |
| 断网 | 静默降级,不阻塞启动;缓存过期 >48h 时附注 |
| 会话内说"帮我更新插件" | Claude 依据 additionalContext 执行正确命令 |

**发布**:dogfood 全绿 → 推 GitHub 公开仓库 → README 安装两行命令。

## 13. 风险清单

1. `systemMessage` 在 VSCode 面板的渲染效果未经实测(schema 支持已取证)→ dogfood 第一项验证。
2. `${CLAUDE_PLUGIN_ROOT}` 在 Windows 下的展开 → dogfood 验证;官方插件同款机制,预期可用。
3. 外部对 Claude 托管的 marketplace 缓存做 git pull,理论上可能与官方自身刷新逻辑竞争 → `--ff-only` + 失败静默兜底,风险可接受。
4. 官方未来若为 VSCode/第三方 marketplace 补上原生提醒,产品价值收窄 → 可接受;产品的差异点仍是"提醒而非静默更新"与跨 marketplace 覆盖。

## 14. 本项目 readme.md 改写方向

注意:Windows 等大小写不敏感文件系统上 `readme.md` 与 `README.md` 无法共存,故将现有 `readme.md` 通过 `git mv` 重命名为 `README.md`(GitHub 惯例),并改写为双语产品说明:一句话定位、安装两行命令、Why 段(官方 autoupdate 的三个盲区)、工作原理(发现/节流刷新/双通道提醒)、隐私声明、开发指引(指向本 spec)。

## 附录 A:已验证的本机文件形态(2026-11-13,Windows)

`installed_plugins.json`(节选,值为数组):

```json
{
  "version": 2,
  "plugins": {
    "superpowers@claude-plugins-official": [
      {
        "scope": "user",
        "version": "5.1.0",
        "gitCommitSha": "f2cbfbefebbfef77321e4c9abc9e949826bea9d7",
        "installPath": "C:\\Users\\...\\cache\\claude-plugins-official\\superpowers\\5.1.0"
      }
    ],
    "skill-creator@claude-plugins-official": [
      { "version": "8435428dfc0f", "gitCommitSha": "8435428dfc0fd6e4fea1c8e505ef5022b1f0d403" }
    ]
  }
}
```

`known_marketplaces.json`(节选):

```json
{
  "claude-plugins-official": {
    "source": { "source": "github", "repo": "anthropics/claude-plugins-official" },
    "installLocation": "C:\\Users\\...\\plugins\\marketplaces\\claude-plugins-official",
    "lastUpdated": "2026-05-29T08:46:14.353Z"
  }
}
```

marketplace `.claude-plugin/marketplace.json` 条目两形态(节选):

```json
{ "name": "superpowers",
  "source": { "source": "url", "url": "https://github.com/obra/superpowers.git",
              "sha": "f2cbfbefebbfef77321e4c9abc9e949826bea9d7" } }

{ "name": "swift-lsp", "version": "1.0.0", "source": "./plugins/swift-lsp" }
```

其他已验证事实:marketplace 缓存目录均为 git 仓库;`marketplaces/` 下存在不在 known_marketplaces.json 中的孤儿目录(thedotmack),遍历以 known_marketplaces.json 为准即可忽略;`claude plugin update <plugin>`、`claude plugin marketplace update [name]` 命令存在,更新后需重启或 `/reload-plugins`。
