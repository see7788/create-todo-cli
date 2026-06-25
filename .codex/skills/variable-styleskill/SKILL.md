---
name: "variable-styleskill"
description: "涉及变量、形参、对象方法、store action、路由层级或文件内命名时使用。约束语义命名、状态名在前、避免动词前置和无意义形参。"
---

# 变量命名风格


## 分流规则

- 前端组件、hook、props、UI 状态和前端 store action 命名使用「前端变量」。
- 后端 route、handler、业务对象、schema、缓存、协议字段和后端 store action 命名使用「后端变量」。
- 对象方法和仓库 action 命名使用「方法和 action」。
- 本 skill 只处理变量、形参和命名语义；作用域拆分看 scope-style，状态流转看 zustand-store-style，网络协议看 net-style。

## 通用命名

- 命名必须表达业务语义或状态语义，不用 `data`、`item`、`temp`、`value` 这类无法区分含义的泛名，除非作用域极小且含义唯一。
- 形参最小化：单点逻辑直接读当前作用域；真实复用后，才把差异提升为形参。
- 禁止为了包一层、传一遍或制造统一形式创建无复用形参。
- 形参名使用调用方能理解的业务名，不用 `param`、`args`、`payload` 兜所有场景；事件对象、库回调等约定俗成名称除外。
- 布尔值命名表达判断语义，例如 `isReady`、`hasError`、`canSubmit`；不要用需要反向理解的含糊名称。
- 数组和集合命名表达元素领域，例如 `messages`、`skillDirs`；不要只写 `list`。
- 命名长度与路径深度选择时，优先规则是保持命名短

## 前端变量

- 前端组件、hook、props、局部状态和 store action 命名必须表达 UI 或业务状态语义，不用 `data`、`item`、`value` 兜底。
- 布尔 UI 状态命名表达判断语义，例如 `isOpen`、`hasError`、`canSubmit`。
- 数组和集合命名表达元素领域，例如 `messages`、`selectedIds`、`skillDirs`；不要只写 `list`。

## 后端变量

- 后端 route、handler、业务对象、schema、缓存和协议字段命名必须表达领域语义，不用 `data`、`payload`、`result` 兜所有场景。
- 路由路径、对象方法和 store action 的业务层级保持一致，避免把领域压扁成难读名称。
- 第三方协议字段按对方协议保留；本项目内部变量和派生值按当前业务语义命名。

## 方法和 action

- 对象方法和仓库 action 命名使用状态名在前、动作在后的方式，例如 `runtime.portNext()`、`dataSet`、`targetIdSet`、`itemAdd`、`itemDel`、`listReset`、`messageSend`、`responseReceive`。
- 禁止动词前置命名，例如 `setData`、`setTargetId`、`addItem`、`deleteItem`。
- 路径可以深、末端方法名尽量短；用对象层级表达领域，例如 `llm.openai.config()`、`agent.codexcli.chat()`。
- 路由路径和仓库 action 的业务层级保持一致；例如 `chatActions.llm.openai.chat()` 对应 `/chat/llm/openai`，避免 `/llmopenai` 这类压扁命名。
