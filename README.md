# pi-tps

English | [简体中文](README.zh-CN.md)

Tokens-per-second (TPS) statistics for the [Pi coding agent](https://github.com/earendil-works/pi). It measures real generation speed per assistant message and shows it in the footer, with a `/tps` report for the whole session.

Pi tracks cumulative token counts and cost, but not speed — this extension fills that gap.

## What you get

- **Live speed while streaming**: `⚡ ~132 tok/s…` (estimated from stream deltas, throttled to 250 ms)
- **Exact speed after each response**: `⚡ 146.8 tok/s · avg 121.4`
- **`/tps` report**: session aggregates (weighted average / median / fastest / slowest) plus a per-message table with `model / output tokens / generation span / TTFT / tok/s`
- **`/tps clear`**: reset the collected statistics

## Install

From this repository (recommended):

```bash
pi install git:github.com/Carri1Sun/pi-tps
```

Or try it once without installing:

```bash
pi -e git:github.com/Carri1Sun/pi-tps
```

Or just copy [`extensions/tps.ts`](extensions/tps.ts) to `~/.pi/agent/extensions/tps.ts`.

Reload your running session with `/reload`, or start a new one.

## How it measures

Simple overall timing (message duration) mixes queueing and time-to-first-token into the number, so pi-tps splits each assistant message into phases:

| Metric | Definition |
|---|---|
| **TTFT** | time from message start to the first streamed content event |
| **gen span** | first content event → last content event (steady-state generation, excludes TTFT) |
| **tok/s** | `usage.output / gen span`, using the provider's authoritative token count |

- Non-streaming providers automatically fall back to the whole message span.
- Aborted or errored responses are skipped, so partial token counts never skew the average.
- Works in interactive mode; in print/JSON/RPC modes the UI parts degrade gracefully and the logic still runs.

## Compatibility

- Pi `>= 0.99.2` (uses the `message_start` / `message_update` / `message_end` extension events and `assistantMessageEvent` stream details).
- No npm dependencies; host-provided packages are declared as peer dependencies.

## License

[MIT](LICENSE)
