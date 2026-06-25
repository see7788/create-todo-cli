---
name: "net-styleskill"
description: "处理 Hono 服务端接口、页面 API 调用、外部 HTTP、SSE、WebSocket 和同进程 Hono 调用时使用。统一网络边界、协议形态、状态入口和响应类型规则。"
---

# 网络调用风格


## 分流规则

- 前端页面请求本项目 Hono API 时按「前端网络 - 页面 API」规则。
- 前端页面消费 SSE 或连接 WebSocket 时按「前端网络 - SSE/WebSocket」规则。
- 后端实现 Hono 服务端接口时按「后端网络 - Hono API」规则。
- 后端请求第三方或远端普通 HTTP API 时按「后端网络 - 外部 HTTP」规则。
- 后端同进程复用 Hono 子路由时按「后端网络 - 同进程 Hono」规则。
- 后端实现 SSE/WebSocket 或消费第三方 SSE/WebSocket 时按对应后端网络协议规则。
- 纯业务逻辑复用优先仓库 action 或业务对象方法，不为复用请求形态绕过业务边界。

## 后端网络 - Hono API

- 路由路径按业务层级组织，避免把领域压扁成难读路径；路由和 action 层级命名使用 variable-style。
- handler 只负责读取请求、校验输入、调用业务对象或 store action、返回响应；复杂业务流程不要堆在 route handler 里，业务边界不存在时按 scope-styleskill「后端作用域」或 zustand-store-styleskill「后端仓库」建最小业务对象或 action。
- 服务端接口禁止 `ctx.json() as ...`；响应类型写在 `ctx.json<T>(...)` 的泛型参数里。
- 普通无数据 JSON 响应写 `ctx.json(null, 200)`，无 body 响应用 `ctx.body(null, 204)`；流式、SSE 和 WebSocket 响应按对应协议规则。
- 错误要明确 throw 或返回明确错误结构；禁止空 catch、静默兜底和隐藏失败原因的兼容逻辑。

## 前端网络 - 页面 API

- React 组件不直接请求服务端接口；页面交互触发 zustand action，action 负责请求和写业务状态。
- 页面交互、组件职责和 UI 临时态使用 scope-styleskill「前端作用域」；业务状态流转使用 zustand-store-styleskill「前端仓库」。
- 页面请求本项目 Hono API 时优先使用项目统一的 Hono `hc` 客户端类型推导，不在组件里散写裸 `fetch`。
- 页面不要直接请求第三方或远端 API；第三方 API 由服务端 Hono 接口封装，再由页面请求本项目 API。
- 页面请求的 loading、error、data 等业务状态进入 store；组件只响应状态变化并触发 action。
- 页面订阅 SSE 或 WebSocket 时，连接生命周期和消息处理进入 store action。

## 后端网络 - 外部 HTTP

- 第三方或远端普通 HTTP API 使用 Hono `hc` 风格，禁止在业务代码里散写裸 `fetch`。
- 第三方没有 Hono 类型时，创建最小 typed wrapper 模拟 hc 调用形态；响应类型在调用点内联，不为单点请求抽顶层 type/schema。
- 同进程 Hono 子路由复用不是外部 HTTP 调用，应使用 `app.request()`。
- 单调用点响应类型内联写在临近 route 或 `ctx.json<T>(...)` 泛型里，禁止为了单点请求抽顶层 type/schema。
- 服务端接口禁止 `ctx.json() as ...`；响应类型写进 `ctx.json<T>(...)` 泛型参数。

## 后端网络 - 外部 HTTP 示例

```ts
const route = new Hono().post("/chat/completions", (ctx) => ctx.json<{
  choices: { message?: { content?: string } }[];
} | {
  error: { code?: string; message: string; type?: string };
}>({} as any));
const response = await hc<typeof route>("https://api.example.com/v1").chat.completions.$post({
  json: input,
});
const body = await response.json();
return ctx.json(body);
```

## 前端/后端网络 - SSE

- SSE 不伪装成普通 JSON 请求；Hono 服务端按事件流输出，页面或服务端消费者使用 `EventSource` 或明确的流式 reader 消费。
- Hono 实现 SSE 接口时，route 只负责建立事件流、写事件和处理关闭；业务事件来源放在业务对象或 store action 边界内。
- SSE 数据进入仓库 action 的事件入口，由仓库按事件增量更新业务状态。
- SSE 数据写入业务状态时，前端使用 zustand-store-styleskill「前端仓库」，后端使用 zustand-store-styleskill「后端仓库」。
- 错误和关闭必须显式处理；至少关闭连接、清理订阅、释放 loading 或 streaming 状态、写入错误状态或错误事件，不要用空 catch 或静默兜底隐藏连接失败。

## 前端网络 - SSE 示例

```ts
const events = new EventSource(`${origin}/events`);
events.addEventListener("message", (event) => {
  const data = JSON.parse(event.data) as { text: string };
  messageReceive(data.text);
});
events.addEventListener("error", () => {
  events.close();
});
```

## 前端/后端网络 - WebSocket

- Hono 实现 WebSocket 接口时使用明确的 WebSocket 升级入口，不伪装成普通 HTTP JSON 接口。
- 页面或服务端连接 WebSocket 时优先使用 Hono `hc` 的 `$ws()` 获取连接；第三方非 Hono WebSocket 按对方协议建立连接。
- WebSocket 消息进入仓库 action 的事件入口，由仓库分发到具体业务状态。
- WebSocket 消息写入业务状态时，前端使用 zustand-store-styleskill「前端仓库」，后端使用 zustand-store-styleskill「后端仓库」。
- 连接 open、message、error、close 行为必须显式表达，不写隐藏失败的兼容逻辑。

## 前端/后端网络 - WebSocket 示例

```ts
const route = new Hono().get("/ws", upgradeWebSocket(() => ({
  onMessage: () => undefined,
})));
const socket = hc<typeof route>(origin).ws.$ws();
socket.addEventListener("open", () => {
  socket.send(JSON.stringify({ type: "hello" }));
});
socket.addEventListener("message", (event) => {
  const data = JSON.parse(String(event.data)) as { type: string };
  messageReceive(data.type);
});
socket.addEventListener("error", () => {
  socket.close();
});
```

## 后端网络 - 同进程 Hono

- 同进程 Hono 子路由复用优先 `app.request()`，不要绕到网络层。
- 只在复用 HTTP 路由语义时使用同进程请求；纯业务逻辑复用优先仓库 action 或业务对象方法。
- 响应透传时保持 `ctx.json<T>(...)` 类型约束，不使用 `ctx.json() as ...`。

## 后端网络 - 同进程 Hono 示例

```ts
const response = await codextplRouter.request("/tpl/source");
const body = await response.json();
return ctx.json(body);
```
