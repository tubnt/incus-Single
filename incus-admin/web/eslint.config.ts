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
  },
  ignores: ["src/app/routeTree.gen.ts", "dist/**"],
});
