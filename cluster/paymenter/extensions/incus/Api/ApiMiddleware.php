<?php

namespace Extensions\Incus\Api;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class ApiMiddleware
{
    private ApiTokenManager $tokenManager;

    public function __construct(ApiTokenManager $tokenManager)
    {
        $this->tokenManager = $tokenManager;
    }

    /**
     * 处理 API 请求：认证 + Rate Limiting
     */
    public function handle(Request $request, Closure $next, ?string $requiredScope = null): JsonResponse|mixed
    {
        // 1. 提取 Bearer token
        $plainToken = $this->extractToken($request);
        if ($plainToken === null) {
            return $this->unauthorized('缺少 Authorization 头或格式错误，需要 Bearer token');
        }

        // 2. 验证 token
        $token = $this->tokenManager->validateToken($plainToken);
        if ($token === null) {
            return $this->unauthorized('无效或已过期的 API Token');
        }

        // 3. Rate limiting
        if (!$this->tokenManager->checkRateLimit($token->user_id)) {
            return response()->json([
                'error'   => 'rate_limit_exceeded',
                'message' => '请求频率超限，每分钟最多 120 次',
            ], 429)->withHeaders([
                'Retry-After' => 60,
                'X-RateLimit-Limit' => 120,
            ]);
        }

        // 4. 权限检查
        if ($requiredScope !== null && !$this->tokenManager->hasPermission($token, $requiredScope)) {
            return response()->json([
                'error'   => 'insufficient_permissions',
                'message' => "Token 缺少所需权限: {$requiredScope}",
            ], 403);
        }

        // 5. 注入认证信息到 request
        $request->attributes->set('api_token', $token);
        $request->attributes->set('api_user_id', $token->user_id);

        return $next($request);
    }

    /**
     * 从请求头提取 Bearer token
     */
    private function extractToken(Request $request): ?string
    {
        $header = $request->header('Authorization', '');
        if (!str_starts_with($header, 'Bearer ')) {
            return null;
        }

        $token = substr($header, 7);
        if (strlen($token) < 20) {
            return null;
        }

        return $token;
    }

    private function unauthorized(string $message): JsonResponse
    {
        return response()->json([
            'error'   => 'unauthorized',
            'message' => $message,
        ], 401);
    }
}
