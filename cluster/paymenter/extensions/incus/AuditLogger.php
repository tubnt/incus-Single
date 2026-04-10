<?php

namespace Extensions\Incus;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Auth;

/**
 * VM 操作审计日志
 *
 * 所有 VM 生命周期和用户操作均通过此类记录审计日志，
 * 输出到 Laravel 日志（systemd journald → Promtail → Loki）。
 */
class AuditLogger
{
    private const CHANNEL = 'incus-audit';

    /**
     * 记录审计日志
     *
     * @param string $action    操作类型（create/suspend/unsuspend/terminate/reboot/reinstall/...）
     * @param string $vmName    VM 名称
     * @param int|null $orderId 订单 ID
     * @param array $details    附加信息
     * @param string $result    操作结果（success/failed）
     * @param int|null $userId  操作者 ID（null 则自动获取当前用户）
     */
    public static function log(
        string $action,
        string $vmName,
        ?int $orderId = null,
        array $details = [],
        string $result = 'success',
        ?int $userId = null
    ): void {
        $userId = $userId ?? Auth::id();

        $entry = [
            'action'    => $action,
            'vm_name'   => $vmName,
            'order_id'  => $orderId,
            'user_id'   => $userId,
            'result'    => $result,
            'ip'        => request()?->ip(),
            'timestamp' => now()->toIso8601String(),
            'details'   => $details,
        ];

        $message = sprintf(
            '[%s] vm=%s order=%s user=%s result=%s',
            $action,
            $vmName,
            $orderId ?? 'N/A',
            $userId ?? 'system',
            $result
        );

        if ($result === 'success') {
            Log::channel(self::CHANNEL)->info($message, $entry);
        } else {
            Log::channel(self::CHANNEL)->error($message, $entry);
        }
    }

    /**
     * 记录成功操作
     */
    public static function success(string $action, string $vmName, ?int $orderId = null, array $details = []): void
    {
        self::log($action, $vmName, $orderId, $details, 'success');
    }

    /**
     * 记录失败操作
     */
    public static function failure(string $action, string $vmName, ?int $orderId = null, array $details = []): void
    {
        self::log($action, $vmName, $orderId, $details, 'failed');
    }
}
