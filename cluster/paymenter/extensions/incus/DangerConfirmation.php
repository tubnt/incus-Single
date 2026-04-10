<?php

namespace Extensions\Incus;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * 危险操作确认 — 重启/重装/删除需输入 VM 名称确认
 *
 * 流程：
 * 1. 用户发起危险操作 → 后端生成确认 token（TTL 5 分钟）
 * 2. 前端弹出确认对话框，要求输入 VM 名称
 * 3. 用户提交 token + VM 名称 → 后端验证后执行操作
 */
class DangerConfirmation
{
    /** @var int 确认 token 过期时间（秒） */
    private const TOKEN_TTL = 300; // 5 分钟

    /** @var string Cache key 前缀 */
    private const CACHE_PREFIX = 'danger_confirm:';

    /** @var array 需要确认的危险操作列表 */
    private const DANGEROUS_ACTIONS = [
        'reboot'    => '重启',
        'reinstall' => '重装系统',
        'terminate' => '删除',
    ];

    /**
     * 生成确认 token
     *
     * 当用户发起危险操作时调用，返回 token 供前端确认使用。
     *
     * @param int    $userId 用户 ID
     * @param string $vmName VM 名称
     * @param string $action 操作类型 (reboot|reinstall|terminate)
     * @return array{token: string, action: string, action_label: string, vm_name: string, expires_in: int}
     * @throws \InvalidArgumentException 操作类型不在白名单中
     */
    public function requestConfirmation(int $userId, string $vmName, string $action): array
    {
        if (!isset(self::DANGEROUS_ACTIONS[$action])) {
            throw new \InvalidArgumentException("不支持的操作类型: {$action}");
        }

        // 验证用户是否拥有该 VM
        $this->verifyOwnership($userId, $vmName);

        // 生成安全 token
        $token = bin2hex(random_bytes(32));
        $cacheKey = self::CACHE_PREFIX . $token;

        // 存储确认信息（TTL 5 分钟）
        Cache::put($cacheKey, [
            'user_id' => $userId,
            'vm_name' => $vmName,
            'action'  => $action,
            'created' => time(),
        ], self::TOKEN_TTL);

        Log::info('[危险操作] 生成确认 token', [
            'user_id' => $userId,
            'vm_name' => $vmName,
            'action'  => $action,
        ]);

        return [
            'token'        => $token,
            'action'       => $action,
            'action_label' => self::DANGEROUS_ACTIONS[$action],
            'vm_name'      => $vmName,
            'expires_in'   => self::TOKEN_TTL,
            'message'      => "请输入 VM 名称 \"{$vmName}\" 以确认" . self::DANGEROUS_ACTIONS[$action] . "操作",
        ];
    }

    /**
     * 验证确认并执行操作
     *
     * @param string $token          确认 token
     * @param string $confirmedName  用户输入的 VM 名称
     * @param int    $userId         当前用户 ID（二次校验）
     * @return array{success: bool, message: string}
     * @throws \RuntimeException 验证失败
     */
    public function verifyAndExecute(string $token, string $confirmedName, int $userId): array
    {
        $cacheKey = self::CACHE_PREFIX . $token;
        $data = Cache::get($cacheKey);

        // 验证 token 存在且未过期
        if (!$data) {
            Log::warning('[危险操作] token 无效或已过期', [
                'user_id' => $userId,
                'token'   => substr($token, 0, 8) . '...',
            ]);
            return ['success' => false, 'message' => '确认令牌无效或已过期，请重新操作'];
        }

        // 验证用户身份一致
        if ($data['user_id'] !== $userId) {
            Log::warning('[危险操作] 用户身份不匹配', [
                'expected' => $data['user_id'],
                'actual'   => $userId,
            ]);
            return ['success' => false, 'message' => '确认令牌无效'];
        }

        // 验证 VM 名称完全匹配
        if ($confirmedName !== $data['vm_name']) {
            Log::info('[危险操作] VM 名称不匹配', [
                'expected' => $data['vm_name'],
                'actual'   => $confirmedName,
            ]);
            return ['success' => false, 'message' => 'VM 名称不匹配，请输入正确的 VM 名称'];
        }

        // token 一次性使用，立即删除
        Cache::forget($cacheKey);

        // 记录审计日志
        DB::table('audit_logs')->insert([
            'user_id'    => $userId,
            'action'     => 'danger_confirmed:' . $data['action'],
            'target'     => $data['vm_name'],
            'meta'       => json_encode([
                'confirmed_name' => $confirmedName,
                'token_created'  => $data['created'],
                'confirmed_at'   => time(),
            ], JSON_UNESCAPED_UNICODE),
            'created_at' => now(),
        ]);

        Log::info('[危险操作] 确认通过，准备执行', [
            'user_id' => $userId,
            'vm_name' => $data['vm_name'],
            'action'  => $data['action'],
        ]);

        return [
            'success'  => true,
            'message'  => '确认成功',
            'action'   => $data['action'],
            'vm_name'  => $data['vm_name'],
        ];
    }

    /**
     * 取消确认（用户主动放弃操作）
     */
    public function cancelConfirmation(string $token, int $userId): bool
    {
        $cacheKey = self::CACHE_PREFIX . $token;
        $data = Cache::get($cacheKey);

        if ($data && $data['user_id'] === $userId) {
            Cache::forget($cacheKey);
            Log::info('[危险操作] 用户取消确认', [
                'user_id' => $userId,
                'action'  => $data['action'],
                'vm_name' => $data['vm_name'],
            ]);
            return true;
        }

        return false;
    }

    /**
     * 获取操作类型的中文标签
     */
    public static function getActionLabel(string $action): string
    {
        return self::DANGEROUS_ACTIONS[$action] ?? $action;
    }

    /**
     * 判断操作是否需要确认
     */
    public static function requiresConfirmation(string $action): bool
    {
        return isset(self::DANGEROUS_ACTIONS[$action]);
    }

    /**
     * 验证用户对 VM 的所有权
     *
     * @throws \RuntimeException 无权操作
     */
    private function verifyOwnership(int $userId, string $vmName): void
    {
        $order = DB::table('orders')
            ->where('user_id', $userId)
            ->where('vm_name', $vmName)
            ->whereIn('status', ['active', 'suspended'])
            ->first();

        if (!$order) {
            throw new \RuntimeException("无权操作该 VM: {$vmName}");
        }
    }
}
