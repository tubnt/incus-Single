import antfu from "@antfu/eslint-config";

export default antfu({
  react: true,
  typescript: true,
  stylistic: false,
  rules: {
    "no-console": "warn",
    "react-refresh/only-export-components": "off",
    // PLAN-051 §2-K 决策 D-24 = A：禁止 (err as Error).message 直显在 toast/Alert。
    // 必须走 formatError(err) 走 HttpError 结构化 body 解析 + 兜底，避免中文用户
    // 看到英文 stack。本规则覆盖最常见的 toast.error 与 AlertDescription 场景。
    "no-restricted-syntax": [
      "error",
      {
        selector: "CallExpression[callee.object.name='toast'][callee.property.name='error'] TSAsExpression > MemberExpression[property.name='message']",
        message: "禁止 toast.error((err as Error).message)；用 formatError(err) 取代",
      },
      {
        selector: "JSXElement[openingElement.name.name='AlertDescription'] TSAsExpression > MemberExpression[property.name='message']",
        message: "禁止 <AlertDescription>{(err as Error).message}</AlertDescription>；用 {formatError(err)} 取代",
      },
    ],
    // pma-cr M3-1 评估：no-misused-promises 需要 typed-linting parser，
    // 引入 typed-lint 让 lint 时间从秒级到分钟级 + 配置复杂度，收益（防回退）
    // 与代价不成比例。留 OPS-047 跟踪；当前防线靠 review + 显式 `void`。
  },
  ignores: ["src/app/routeTree.gen.ts", "dist/**"],
});
