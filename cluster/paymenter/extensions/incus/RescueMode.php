<?php

namespace App\Extensions\Incus;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * 救援模式管理
 *
 * VM 无法正常启动时，以 rescue 镜像启动并挂载原磁盘到 /mnt，
 * 用户可通过临时 root 密码登录修复系统。最长 2 小时自动退出。
 */
class RescueMode
{
    private IncusClient $client;

    /** 救援模式最长持续时间（秒） */
    private const MAX_RESCUE_DURATION = 7200;

    /** 救援镜像别名 */
    private const RESCUE_IMAGE = 'rescue-ubuntu-22.04';

    public function __construct(IncusClient $client)
    {
        $this->client = $client;
    }

    /**
     * 验证 VM 属于指定用户
     *
     * @throws \RuntimeException 当 VM 不属于该用户时
     */
    private function assertVmOwnership(string $vmName, int $userId): void
    {
        $exists = DB::table('order_products')
            ->join('orders', 'order_products.order_id', '=', 'orders.id')
            ->where('order_products.vm_name', $vmName)
            ->where('orders.user_id', $userId)
            ->exists();

        if (!$exists) {
            throw new \RuntimeException("VM [{$vmName}] 不属于当前用户，拒绝操作");
        }
    }

    /**
     * 进入救援模式
     *
     * 流程：停止 VM → 备份原配置 → 以 rescue 镜像启动（挂载原磁盘为 /mnt）→ 生成临时密码
     *
     * @param string $vmName VM 实例名称
     * @param int    $userId 操作用户 ID（用于所有权验证）
     * @return array{password: string, expires_at: string} 临时密码和过期时间
     * @throws \RuntimeException
     */
    public function enterRescue(string $vmName, int $userId): array
    {
        $this->assertVmOwnership($vmName, $userId);
        if ($this->isInRescue($vmName)) {
            throw new \RuntimeException("VM {$vmName} 已在救援模式中");
        }

        // 获取当前 VM 配置（用于退出时恢复）
        $instance = $this->client->request('GET', "/1.0/instances/{$vmName}");
        $originalConfig = $instance['metadata'] ?? [];

        // 停止 VM
        $this->stopVm($vmName);

        $expiresAt = now()->addSeconds(self::MAX_RESCUE_DURATION);

        // 获取原根盘设备信息
        $rootDevice = $originalConfig['devices']['root'] ?? [];
        $rootPool = $rootDevice['pool'] ?? 'default';

        // 挂载原磁盘到 /mnt + 设置 rescue 标记
        $rescueDevices = $originalConfig['devices'] ?? [];
        $rescueDevices['rescue-original-disk'] = [
            'type' => 'disk',
            'pool' => $rootPool,
            'source' => $rootDevice['source'] ?? $vmName,
            'path' => '/mnt',
        ];

        $rescueConfig = $originalConfig['config'] ?? [];
        $rescueConfig['user.rescue_mode'] = 'true';
        $rescueConfig['user.rescue_expires'] = $expiresAt->toIso8601String();

        $this->client->request('PUT', "/1.0/instances/{$vmName}", [
            'config' => $rescueConfig,
            'devices' => $rescueDevices,
        ]);

        // config 已标记 rescue，后续步骤失败时必须回滚
        try {
            // 使用 rebuild API 更换启动镜像（PUT 时 source 字段无效）
            $this->client->request('POST', "/1.0/instances/{$vmName}/rebuild", [
                'source' => [
                    'type' => 'image',
                    'alias' => self::RESCUE_IMAGE,
                ],
            ]);

            // 启动 VM
            $this->client->request('PUT', "/1.0/instances/{$vmName}/state", [
                'action' => 'start',
            ]);

            // 等待 VM 启动后设置临时 root 密码
            $tempPassword = $this->generateTempPassword();
            $this->waitForAgent($vmName);

            // 使用 chpasswd 的 stdin 传入密码，避免命令注入
            $this->client->request('POST', "/1.0/instances/{$vmName}/exec", [
                'command' => ['chpasswd'],
                'wait-for-websocket' => false,
                'stdin' => 'root:' . $tempPassword . "\n",
            ]);
        } catch (\Throwable $e) {
            // 回滚：清除 rescue 标记，恢复原配置
            Log::error("进入救援模式失败，正在回滚：{$vmName} - {$e->getMessage()}");
            try {
                $this->stopVm($vmName);
                $originalDevices = $originalConfig['devices'] ?? [];
                unset($originalDevices['rescue-original-disk']);
                $rollbackConfig = $originalConfig['config'] ?? [];
                unset($rollbackConfig['user.rescue_mode'], $rollbackConfig['user.rescue_expires']);
                $this->client->request('PUT', "/1.0/instances/{$vmName}", [
                    'config' => $rollbackConfig,
                    'devices' => $originalDevices,
                ]);
            } catch (\Throwable $rollbackEx) {
                Log::critical("救援模式回滚也失败：{$vmName} - {$rollbackEx->getMessage()}");
            }
            throw new \RuntimeException("进入救援模式失败：{$e->getMessage()}", 0, $e);
        }

        // 所有 Incus 操作成功后再写 DB，避免 orphan 记录
        DB::table('vm_rescue_sessions')->insert([
            'vm_name' => $vmName,
            'original_boot_image' => $originalConfig['config']['image.description'] ?? '',
            'original_root_device' => json_encode($originalConfig['devices']['root'] ?? []),
            'expires_at' => $expiresAt,
            'created_at' => now(),
        ]);

        Log::info("VM {$vmName} 已进入救援模式，将在 {$expiresAt} 自动退出");

        return [
            'password' => $tempPassword,
            'expires_at' => $expiresAt->toIso8601String(),
        ];
    }

    /**
     * 退出救援模式（恢复原配置启动）
     *
     * @param string $vmName VM 实例名称
     * @param int|null $userId 操作用户 ID（为 null 时跳过所有权验证，仅供定时清理任务使用）
     * @throws \RuntimeException
     */
    public function exitRescue(string $vmName, ?int $userId = null): void
    {
        if ($userId !== null) {
            $this->assertVmOwnership($vmName, $userId);
        }
        if (!$this->isInRescue($vmName)) {
            throw new \RuntimeException("VM {$vmName} 不在救援模式中");
        }

        // 从数据库获取原始配置
        $session = DB::table('vm_rescue_sessions')
            ->where('vm_name', $vmName)
            ->whereNull('exited_at')
            ->orderByDesc('created_at')
            ->first();

        if (!$session) {
            throw new \RuntimeException("未找到 VM {$vmName} 的救援会话记录");
        }

        // 停止 rescue VM
        $this->stopVm($vmName);

        // 获取当前配置
        $instance = $this->client->request('GET', "/1.0/instances/{$vmName}");
        $currentConfig = $instance['metadata'] ?? [];

        // 恢复原始配置
        $originalRootDevice = json_decode($session->original_root_device, true);
        if (!is_array($originalRootDevice) || empty($originalRootDevice)) {
            throw new \RuntimeException("VM {$vmName} 的原始根设备配置已损坏，无法自动恢复");
        }
        $devices = $currentConfig['devices'] ?? [];

        // 移除 rescue 相关设备，恢复原根盘
        unset($devices['rescue-original-disk']);
        $devices['root'] = $originalRootDevice;

        // 清除 rescue 标记
        $config = $currentConfig['config'] ?? [];
        unset($config['user.rescue_mode'], $config['user.rescue_expires']);

        $this->client->request('PUT', "/1.0/instances/{$vmName}", [
            'config' => $config,
            'devices' => $devices,
        ]);

        // 正常启动 VM
        $this->client->request('PUT', "/1.0/instances/{$vmName}/state", [
            'action' => 'start',
        ]);

        // 标记会话已结束
        DB::table('vm_rescue_sessions')
            ->where('id', $session->id)
            ->update(['exited_at' => now()]);

        Log::info("VM {$vmName} 已退出救援模式，恢复正常启动");
    }

    /**
     * 检查 VM 是否在救援模式中
     */
    public function isInRescue(string $vmName): bool
    {
        $instance = $this->client->request('GET', "/1.0/instances/{$vmName}");
        $config = $instance['metadata']['config'] ?? [];

        return ($config['user.rescue_mode'] ?? '') === 'true';
    }

    /**
     * 清理过期的救援会话（由定时任务调用）
     *
     * @return array 已清理的 VM 名称列表
     */
    public function cleanupExpiredSessions(): array
    {
        $expired = DB::table('vm_rescue_sessions')
            ->whereNull('exited_at')
            ->where('expires_at', '<', now())
            ->get();

        $cleaned = [];
        foreach ($expired as $session) {
            try {
                if ($this->isInRescue($session->vm_name)) {
                    // Incus 侧仍有 rescue 标记，走完整退出流程
                    $this->exitRescue($session->vm_name);
                } else {
                    // Incus 侧已无 rescue 标记（手动清除等），仅关闭 DB 记录
                    DB::table('vm_rescue_sessions')
                        ->where('id', $session->id)
                        ->update(['exited_at' => now()]);
                    Log::info("救援会话 DB 记录已关闭（Incus 侧已无标记）：{$session->vm_name}");
                }
                $cleaned[] = $session->vm_name;
                Log::info("自动退出救援模式：{$session->vm_name}（已超时）");
            } catch (\Throwable $e) {
                Log::error("清理过期救援会话失败：{$session->vm_name} - {$e->getMessage()}");
            }
        }

        return $cleaned;
    }

    /**
     * 获取救援会话信息
     */
    public function getRescueInfo(string $vmName): ?array
    {
        $session = DB::table('vm_rescue_sessions')
            ->where('vm_name', $vmName)
            ->whereNull('exited_at')
            ->orderByDesc('created_at')
            ->first();

        if (!$session) {
            return null;
        }

        return [
            'vm_name' => $session->vm_name,
            'started_at' => $session->created_at,
            'expires_at' => $session->expires_at,
            'remaining_seconds' => max(0, now()->diffInSeconds($session->expires_at, false)),
        ];
    }

    private function stopVm(string $vmName): void
    {
        $state = $this->client->request('GET', "/1.0/instances/{$vmName}/state");
        $status = $state['metadata']['status'] ?? '';

        if ($status === 'Running') {
            $this->client->request('PUT', "/1.0/instances/{$vmName}/state", [
                'action' => 'stop',
                'timeout' => 30,
                'force' => true,
            ]);
        }
    }

    private function generateTempPassword(): string
    {
        return Str::random(16);
    }

    /**
     * 等待 VM 内 agent 就绪（最多 60 秒）
     */
    private function waitForAgent(string $vmName, int $timeout = 60): void
    {
        $start = time();
        while (time() - $start < $timeout) {
            $state = $this->client->request('GET', "/1.0/instances/{$vmName}/state");
            $processes = $state['metadata']['processes'] ?? -1;
            if ($processes > 0) {
                return;
            }
            sleep(2);
        }

        throw new \RuntimeException("VM {$vmName} agent 未在 {$timeout} 秒内就绪，无法设置密码");
    }
}
