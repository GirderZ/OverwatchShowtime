# 周报／月报读取协议

周报固定入口 `latest-week.json`，schema 为 `overwatch-time.weekly.v1`；月报固定入口 `latest-month.json`，schema 为 `overwatch-time.monthly.v1`。

UTF-8 JSON，带 `Ms` 后缀的数值为毫秒。日／周／月按北京时间 `Asia/Shanghai` 划分；ISO 时间戳使用 UTC。周一 00:00 起到下周一 00:00，月初 00:00 起到下月初 00:00，右端不包含。

| 字段 | 含义 |
| --- | --- |
| `period.type` | `week` 或 `month` |
| `period.start` | 周一或月初日期，作为去重键 |
| `period.endInclusive` | 周日或月末日期 |
| `period.endExclusive` | 下周一或下月初日期 |
| `period.complete` | 是否已完成自然周期；推送只处理 true |
| `generatedAt` | 生成或修订时间 |
| `contentHash` | 内容指纹，不含生成时间；同周期数据修订后变化 |
| `primaryMetric` | `foregroundMs` |
| `totals.runningMs` | 已记录游戏运行时长 |
| `totals.foregroundMs` | 已记录游戏前台时长 |
| `totals.backgroundMs` | 运行减前台 |
| `totals.idleMs` | 前台且超过当时无操作阈值的时长，不等于挂机 |
| `totals.activeEstimateMs` | 前台减疑似无操作，仅估算 |
| `totals.sessionCount` | 游玩段数，不是对局数 |
| `totals.playedDays` | 有运行记录的天数 |
| `totals.longestSessionMs` | 周期内单段最长运行时间 |
| `daily[]` | 周报 7 天，月报按月份 28/29/30/31 天 |
| `hourlyForegroundMs[]` | 0—23 时段的累计前台时长，共 24 项 |
| `comparison.comparable` | 上期存在监测覆盖，不保证本期与上期都完整监测 |
| `comparison.deltaForegroundMs` | 本期减上期 |
| `comparison.percent` | 增减百分比；上期为零时 null |
| `coverage.monitoringMs` | 正常监测覆盖时长，包含没开游戏的时间 |
| `coverage.note` | 数据缺失说明，推送应保留其含义 |
| `insights.peakHour` | 高峰小时 0—23，无前台记录时 null |
| `insights.busiestDate` | 前台最多的日期，无记录时 null |
| `insights.weekdayForegroundMs` | 工作日前台时长 |
| `insights.weekendForegroundMs` | 周末前台时长 |
| `insights.averagePlayedDayMs` | 按有游玩记录天数计算的日均前台时长 |

v0.2.0 保留 v0.1.0 的核心计时字段与周报入口；增加月报与 insights，时间预算字段已移除。外部读取者只依赖上表字段，忽略未知字段。

读取流程：等待同步完成 → 验证 schema 与完整周期 → 按周期类型和开始日期去重 → 检查内容指纹 → 生成摘要 → 按用户授权的渠道推送。JSON 优先于其他可能尚未同步完的文件。

这是一份本地文件交换协议，没有网络端口、登录令牌或自动发送功能。缺少记录不等于没有游玩，不能从这些数据推断胜负、段位、英雄表现或健康状况。
