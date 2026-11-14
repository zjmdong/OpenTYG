# How it works

[文档](README.md) / 工作流程 · [English](how-it-works.en.md)

本页解释当前网页应用的运行流程。模块与存储位置见 [架构说明](architecture.md)，字段与错误码见 [后端 API](api.md)。

## 一次点按，从页面到平台

```mermaid
sequenceDiagram
    participant B as 浏览器
    participant A as OpenTYG 后端与 SDK
    participant P as 桃园谷平台
    B->>A: POST /api/doors/open<br/>房产、目录、门 ID
    A->>A: 校验会话与目录，限制账号并发
    opt 连接或权限校验需更新
        A->>P: 必要时重新查询房产权
        par 门禁鉴权
            A->>P: 获取 authcode
        and 建立通道
            A->>P: WebSocket 握手
        end
        A->>P: 下载当前门禁目录
        P-->>A: 设备配置
        A->>A: 重新定位同一个稳定门 ID
    end
    A->>P: OpenDoor（校验冷却后发送一次）
    alt 收到可匹配回执
        P-->>A: 成功或业务拒绝
        A-->>B: 结果与实际使用的目录上下文
    else 可能已发送，但回执丢失
        A-->>B: 结果未知，不自动重发
    end
```

准备失败、权限失效或门被移除时，流程在发送前结束。正常回执等待默认 5 秒；平台成功回执不证明物理门锁一定开启。

### 三个 ID，各管什么

| 字段 | 作用 |
| --- | --- |
| `householdId` | 当前选中的授权房产 |
| `directoryId` | UI 使用的目录快照，防止旧操作落到新目录 |
| `doorId` | 从平台稳定标识派生的门 ID，不使用列表位置 |

自动重连仅在房产及完整设备/配置指纹不变时保留 UI 目录 ID；SDK 内部连接仍使用新目录。显式 `refresh=1` 强制新上下文。前端收到明确的 `STALE_DIRECTORY` 拒绝后，可在账号、房产与目标门不变的条件下刷新并继续原点击。

## 为什么连接可重试，开门不能盲目重发

```mermaid
flowchart TB
    F["连接失败或回执丢失"] --> Sent{"命令可能已发送？"}
    Sent -->|是| Unknown["结果未知<br/>用户核实现场，不自动重发"]
    Sent -->|明确未发送| Retry{"可重试的网络错误<br/>且次数、时间仍有余量？"}
    Retry -->|是| Prepare["重新准备连接与目录<br/>校验同一目标后再发送"]
    Retry -->|否| Stop["返回错误，结束本次操作"]
    classDef default fill:#eef4ff,stroke:#8ca9dc,color:#101827
    classDef stop fill:#fff4e5,stroke:#b07824,color:#603b0c
    class Unknown,Stop stop
```

- 准备和明确未入队的失败共享约 **2.9 秒、最多 3 次尝试**的预算；单阶段无响应时限约 **950ms**。
- `GET /api/doors` 使用从请求开始计算的约 **3 秒剩余预算**。这些是配置时限，不是成功时延保证。
- 业务拒绝、权限撤销和已发送后的回执超时不进入自动重试。
- 协议没有供本实现使用的幂等请求编号；“没收到响应”不能推导成“没开门”。

## 登录恢复与失效

```mermaid
flowchart TB
    Start["读取 session / bootstrap"] --> Cookie{"本服务 Cookie 有效？"}
    Cookie -->|否| Login["返回未登录"]
    Cookie -->|是| Memory{"内存登录仍在？"}
    Memory -->|是| View["返回本用户的会话视图"]
    Memory -->|否| Restore["读取加密的记住登录数据<br/>恢复 SDK 并查询房产权"]
    Restore --> Result{"恢复结果"}
    Result -->|有效| View
    Result -->|主 token 明确过期| Expire["清理该账号登录与本服务会话<br/>返回 401，保留收藏与设置"]
    Result -->|暂时网络或存储故障| Error["返回错误<br/>不按主凭据过期清理账号"]
    Result -->|无可用保存登录| Login
    classDef default fill:#eef4ff,stroke:#8ca9dc,color:#101827
    classDef core fill:#2f6bed,stroke:#2f6bed,color:#ffffff
    class View core
```

“内存登录仍在”只表示可恢复会话视图，后续门禁操作仍检查权限与连接。房产权查询明确报告主 token 过期时，无论在恢复还是业务操作中，都撤销该账号的本服务会话；其他账号不受影响。房产临时 token 失效则在准备时限内刷新，不等同于主登录过期。

| 生命周期 | 当前值或行为 |
| --- | --- |
| 普通浏览器会话 | 最长 12 小时，重启不恢复 |
| 记住登录 | 最长 30 天绝对期限，平台可提前失效 |
| 健康目录 / 房产权校验 | 最长复用约 60 秒 |
| 闲置 WebSocket | 30 分钟后释放 |
| 内存登录与服务配置 | 约 24 小时闲置、最多 200 个账号，可提前 LRU 回收 |

旧收藏视图仅用于更快展示；缓存不延长会话有效期，也不代替平台授权。完整存储边界见 [隐私与运维](security.md)。

## 对照源码阅读

| 入口 | 关注点 |
| --- | --- |
| [web/js/open.js](../web/js/open.js) | 用户意图、过期目录刷新、结果未知提示 |
| [web/js/doorConnection.js](../web/js/doorConnection.js) | 合并前台恢复与预热 |
| [server/app.mjs](../server/app.mjs) | 会话与目录校验、账号并发、过期清理 |
| [server/service.mjs](../server/service.mjs) | 准备预算、权限刷新、稳定门 ID、发送边界 |
| [内嵌 SDK](../server/vendor/tyg-core-sdk/src/tyg-client.mjs) | 平台凭据、WebSocket 消息与回执 |

这里描述的是 main 的适配实现。独立 SDK 的临时目录引用、保存和恢复策略不同，见 [SDK 工作流程](https://github.com/zjmdong/OpenTYG/blob/opentyg-sdk/docs/how-it-works.md)。
