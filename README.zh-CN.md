# pi-tps

[English](README.md) | 简体中文

为 [Pi coding agent](https://github.com/earendil-works/pi) 提供每秒生成 token 数（TPS）统计：按 assistant 消息测量真实生成速度，显示在底部状态栏，并可用 `/tps` 查看整场会话报告。

Pi 自身统计累计 token 量和费用，但不统计速度——这个扩展补上这一块。

## 功能

- **流式生成中的实时速度**：`⚡ ~132 tok/s…`（按流式 delta 估算，250ms 节流刷新）
- **每条响应完成后的精确速度**：`⚡ 146.8 tok/s · avg 121.4`
- **`/tps` 报告**：会话汇总（加权平均 / 中位数 / 最快 / 最慢）+ 每条消息明细表（`模型 / 输出 token / 生成跨度 / TTFT / tok/s`）
- **`/tps clear`**：清空已收集的统计

## 安装

从本仓库安装（推荐）：

```bash
pi install git:github.com/Carri1Sun/pi-tps
```

或者不安装、先试用一次：

```bash
pi -e git:github.com/Carri1Sun/pi-tps
```

或者直接把 [`extensions/tps.ts`](extensions/tps.ts) 复制到 `~/.pi/agent/extensions/tps.ts`。

已运行的会话执行 `/reload` 热加载，或新开一个会话。

## 统计口径

简单的总时长平均会把排队时间和首 token 延迟混进来，所以 pi-tps 把每条 assistant 消息拆成几个阶段：

| 指标 | 定义 |
|---|---|
| **TTFT** | 消息开始 → 第一个流式内容事件（首 token 延迟） |
| **gen span** | 第一个内容事件 → 最后一个内容事件（稳态生成跨度，不含 TTFT） |
| **tok/s** | `usage.output / gen span`，使用 provider 返回的权威 token 数 |

- 非流式 provider 自动回退为整条消息时长计算。
- 中止 / 出错的响应会被跳过，残缺的 token 计数不会拉低平均值。
- 交互模式完整可用；print / JSON / RPC 模式下 UI 部分自动降级，统计逻辑照常运行。

## 兼容性

- Pi `>= 0.99.2`（依赖 `message_start` / `message_update` / `message_end` 扩展事件及 `assistantMessageEvent` 流式细节）。
- 无 npm 依赖；宿主提供的包声明为 peer dependencies。

## 许可证

[MIT](LICENSE)
