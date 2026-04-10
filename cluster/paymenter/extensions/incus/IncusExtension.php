<?php

namespace Extensions\Incus;

use App\Classes\Extensions\Server\ServerExtension;
use Illuminate\Support\Facades\Log;

/**
 * Incus 云主机 Server Extension
 *
 * 实现 Paymenter 的 ServerExtension 接口，通过 Incus REST API
 * 管理 VM 生命周期（创建/暂停/恢复/终止）和用户操作。
 *
 * 所有操作均通过 VmOperationLock 进行并发保护，
 * 并通过 AuditLogger 记录审计日志。
 */
class IncusExtension extends ServerExtension
{
    private IncusClient $client;
    private IpPoolManager $ipPool;
    private UserOperations $userOps;
    private array $config;

    public function __construct()
    {
        $this->config = require __DIR__ . '/config.php';
        $this->client = new IncusClient(
            $this->config['endpoint'],
            $this->config['cert_file'],
            $this->config['key_file'],
            $this->config['project'],
            $this->config['timeout'],
            $this->config['max_retries']
        );
        $this->ipPool = new IpPoolManager();
        $this->userOps = new UserOperations($this->client);
    }

    // ========================================================
    //  元数据
    // ========================================================

    public function getMetadata(): array
    {
        return [
            'display_name' => 'Incus 云主机',
            'version'      => '1.0.0',
            'author'       => '5ok',
        ];
    }

    public function getConfig(): array
    {
        return [
            [
                'name'        => 'server_id',
                'type'        => 'text',
                'friendlyName' => 'Paymenter Server ID',
                'required'    => true,
            ],
        ];
    }

    public function getProductConfig($options): array
    {
        return [
            [
                'name'        => 'cpu',
                'type'        => 'text',
                'friendlyName' => 'CPU 核心数',
                'required'    => true,
                'default'     => '1',
            ],
            [
                'name'        => 'memory',
                'type'        => 'text',
                'friendlyName' => '内存 (GiB)',
                'required'    => true,
                'default'     => '1',
            ],
            [
                'name'        => 'disk',
                'type'        => 'text',
                'friendlyName' => '磁盘 (GiB)',
                'required'    => true,
                'default'     => '20',
            ],
            [
                'name'        => 'bandwidth',
                'type'        => 'text',
                'friendlyName' => '带宽限速',
                'required'    => false,
                'default'     => $this->config['default_bandwidth'],
            ],
            [
                'name'        => 'image',
                'type'        => 'text',
                'friendlyName' => '系统镜像',
                'required'    => true,
                'default'     => 'images:ubuntu/24.04',
            ],
        ];
    }

    // ========================================================
    //  生命周期方法
    // ========================================================

    /**
     * 创建 VM
     *
     * 1. 从 IP 池分配 IP
     * 2. 调用 Incus API 创建 VM（cloud-init 注入网络+密码+SSH Key）
     * 3. 绑定 ipv4_filtering + mac_filtering + port_isolation
     * 4. 设置带宽限速（limits.ingress/egress）
     * 5. 创建用户级 ACL（默认 ingress drop）
     * 6. 记录审计日志
     */
    public function createServer($user, $params, $order, $product, $options)
    {
        $vmName = 'vm-' . $order->id;
        $serverId = $options['server_id'];
        $cpu = $params['cpu'] ?? $product->settings['cpu'] ?? '1';
        $memory = $params['memory'] ?? $product->settings['memory'] ?? '1';
        $disk = $params['disk'] ?? $product->settings['disk'] ?? '20';
        $bandwidth = $params['bandwidth'] ?? $product->settings['bandwidth'] ?? $this->config['default_bandwidth'];
        $image = $params['image'] ?? $product->settings['image'] ?? 'images:ubuntu/24.04';
        $password = $params['password'] ?? bin2hex(random_bytes(12));

        return VmOperationLock::withLock($vmName, 'create', function () use (
            $vmName, $serverId, $cpu, $memory, $disk, $bandwidth, $image, $password, $user, $order
        ) {
            try {
                // 1. 分配 IP
                $ip = $this->ipPool->allocate($serverId, $vmName, $order->id);

                // 2. 创建 ACL
                $aclName = "acl-{$vmName}";
                $this->client->post('/1.0/network-acls', [
                    'name'    => $aclName,
                    'ingress' => $this->config['default_acl']['ingress'] ?? [],
                    'egress'  => [],
                    'config'  => [
                        'default.action' => 'drop',
                        'default.logged' => 'true',
                    ],
                ]);

                // 3. 构建 cloud-init
                $cloudInit = $this->buildCloudInit(
                    $vmName, $password, $ip['ip'], $ip['gateway'], $ip['netmask'],
                    $user->ssh_keys ?? []
                );

                // 4. 创建 VM 实例
                $result = $this->client->post('/1.0/instances', [
                    'name'   => $vmName,
                    'type'   => 'virtual-machine',
                    'source' => [
                        'type'  => 'image',
                        'alias' => $image,
                    ],
                    'config' => [
                        'limits.cpu'              => (string)$cpu,
                        'limits.memory'           => "{$memory}GiB",
                        'cloud-init.user-data'    => $cloudInit,
                        'security.ipv4_filtering' => 'true',
                        'security.mac_filtering'  => 'true',
                        'security.port_isolation' => 'true',
                    ],
                    'devices' => [
                        'eth0' => [
                            'type'           => 'nic',
                            'network'        => 'br0',
                            'ipv4.address'   => $ip['ip'],
                            'limits.ingress' => $bandwidth,
                            'limits.egress'  => $bandwidth,
                            'security.acls'  => $aclName,
                        ],
                        'root' => [
                            'type' => 'disk',
                            'pool' => $this->config['storage_pool'],
                            'path' => '/',
                            'size' => "{$disk}GiB",
                        ],
                    ],
                ]);

                // 5. 启动 VM
                $this->client->put("/1.0/instances/{$vmName}/state", [
                    'action'  => 'start',
                    'timeout' => 60,
                ]);

                // 6. 审计日志
                AuditLogger::success('create', $vmName, $order->id, [
                    'ip'    => $ip['ip'],
                    'cpu'   => $cpu,
                    'memory' => $memory,
                    'disk'  => $disk,
                    'image' => $image,
                ]);

                return [
                    'vm_name'  => $vmName,
                    'ip'       => $ip['ip'],
                    'password' => $password,
                ];
            } catch (\Throwable $e) {
                AuditLogger::failure('create', $vmName, $order->id, ['error' => $e->getMessage()]);
                throw $e;
            }
        });
    }

    /**
     * 暂停 VM — 到期暂停
     *
     * incus stop <vm> --stateful（保留内存状态暂停）
     */
    public function suspendServer($user, $params, $order, $product, $options)
    {
        $vmName = 'vm-' . $order->id;

        return VmOperationLock::withLock($vmName, 'suspend', function () use ($vmName, $order) {
            try {
                $result = $this->client->put("/1.0/instances/{$vmName}/state", [
                    'action'   => 'stop',
                    'timeout'  => 120,
                    'force'    => false,
                    'stateful' => true,
                ]);

                AuditLogger::success('suspend', $vmName, $order->id);

                return $result;
            } catch (\Throwable $e) {
                AuditLogger::failure('suspend', $vmName, $order->id, ['error' => $e->getMessage()]);
                throw $e;
            }
        });
    }

    /**
     * 恢复 VM — 续费恢复
     *
     * incus start <vm>
     */
    public function unsuspendServer($user, $params, $order, $product, $options)
    {
        $vmName = 'vm-' . $order->id;

        return VmOperationLock::withLock($vmName, 'unsuspend', function () use ($vmName, $order) {
            try {
                $result = $this->client->put("/1.0/instances/{$vmName}/state", [
                    'action'   => 'start',
                    'timeout'  => 60,
                    'stateful' => true,
                ]);

                AuditLogger::success('unsuspend', $vmName, $order->id);

                return $result;
            } catch (\Throwable $e) {
                AuditLogger::failure('unsuspend', $vmName, $order->id, ['error' => $e->getMessage()]);
                throw $e;
            }
        });
    }

    /**
     * 终止 VM — 永久删除
     *
     * 1. incus delete <vm> --force
     * 2. 回收 IP 到 cooldown 池（24h）
     * 3. 删除 ACL
     * 4. 删除附加磁盘卷
     * 5. 审计日志
     */
    public function terminateServer($user, $params, $order, $product, $options)
    {
        $vmName = 'vm-' . $order->id;

        return VmOperationLock::withLock($vmName, 'terminate', function () use ($vmName, $order) {
            try {
                // 1. 获取 VM 磁盘设备列表（用于后续清理）
                $instance = $this->client->get("/1.0/instances/{$vmName}");
                $devices = $instance['metadata']['devices'] ?? [];

                // 2. 强制删除 VM
                $this->client->delete("/1.0/instances/{$vmName}?force=true");

                // 3. 回收 IP 到 cooldown 池
                $this->ipPool->release($vmName, $this->config['ip_cooldown_hours']);

                // 4. 删除用户级 ACL
                $aclName = "acl-{$vmName}";
                try {
                    $this->client->delete("/1.0/network-acls/{$aclName}");
                } catch (\Throwable $e) {
                    Log::warning("删除 ACL [{$aclName}] 失败（可能不存在）: " . $e->getMessage());
                }

                // 5. 删除附加磁盘卷（排除 root 设备）
                foreach ($devices as $name => $device) {
                    if ($name === 'root' || ($device['type'] ?? '') !== 'disk') {
                        continue;
                    }
                    $pool = $device['pool'] ?? $this->config['storage_pool'];
                    $source = $device['source'] ?? null;
                    if ($source) {
                        try {
                            $this->client->delete("/1.0/storage-pools/{$pool}/volumes/custom/{$source}");
                        } catch (\Throwable $e) {
                            Log::warning("删除磁盘卷 [{$pool}/{$source}] 失败: " . $e->getMessage());
                        }
                    }
                }

                // 6. 审计日志
                AuditLogger::success('terminate', $vmName, $order->id);

                return ['status' => 'terminated'];
            } catch (\Throwable $e) {
                AuditLogger::failure('terminate', $vmName, $order->id, ['error' => $e->getMessage()]);
                throw $e;
            }
        });
    }

    // ========================================================
    //  用户操作（委托给 UserOperations）
    // ========================================================

    public function reboot($params)
    {
        return $this->userOps->reboot($params['vm_name'], $params['order_id']);
    }

    public function reinstall($params)
    {
        return $this->userOps->reinstall(
            $params['vm_name'],
            $params['order_id'],
            $params['image'],
            $params['password'],
            $params['config']
        );
    }

    public function changePassword($params)
    {
        return $this->userOps->changePassword($params['vm_name'], $params['order_id'], $params['password']);
    }

    public function addSshKey($params)
    {
        return $this->userOps->addSshKey($params['vm_name'], $params['order_id'], $params['public_key']);
    }

    public function getConsoleUrl($params)
    {
        $vmName = $params['vm_name'];
        return [
            'url' => $this->config['endpoint'] . "/1.0/instances/{$vmName}/console",
        ];
    }

    // ========================================================
    //  快照
    // ========================================================

    public function createSnapshot($params)
    {
        $vmName = $params['vm_name'];

        return VmOperationLock::withLock($vmName, 'create_snapshot', function () use ($vmName, $params) {
            $name = $params['name'] ?? 'snap-' . time();

            $result = $this->client->post("/1.0/instances/{$vmName}/snapshots", [
                'name'     => $name,
                'stateful' => false,
            ]);

            AuditLogger::success('create_snapshot', $vmName, $params['order_id'] ?? null, ['snapshot' => $name]);

            return $result;
        });
    }

    public function restoreSnapshot($params)
    {
        $vmName = $params['vm_name'];

        return VmOperationLock::withLock($vmName, 'restore_snapshot', function () use ($vmName, $params) {
            $result = $this->client->put("/1.0/instances/{$vmName}", [
                'restore' => $params['snapshot_name'],
            ]);

            AuditLogger::success('restore_snapshot', $vmName, $params['order_id'] ?? null, [
                'snapshot' => $params['snapshot_name'],
            ]);

            return $result;
        });
    }

    public function deleteSnapshot($params)
    {
        $vmName = $params['vm_name'];
        $snapName = $params['snapshot_name'];

        $result = $this->client->delete("/1.0/instances/{$vmName}/snapshots/{$snapName}");

        AuditLogger::success('delete_snapshot', $vmName, $params['order_id'] ?? null, ['snapshot' => $snapName]);

        return $result;
    }

    // ========================================================
    //  升降配
    // ========================================================

    public function upgrade($params)
    {
        $vmName = $params['vm_name'];

        return VmOperationLock::withLock($vmName, 'upgrade', function () use ($vmName, $params) {
            $result = $this->client->patch("/1.0/instances/{$vmName}", [
                'config' => [
                    'limits.cpu'    => (string)$params['cpu'],
                    'limits.memory' => $params['memory'] . 'GiB',
                ],
            ]);

            AuditLogger::success('upgrade', $vmName, $params['order_id'] ?? null, [
                'cpu'    => $params['cpu'],
                'memory' => $params['memory'],
            ]);

            return $result;
        });
    }

    public function downgrade($params)
    {
        $vmName = $params['vm_name'];

        return VmOperationLock::withLock($vmName, 'downgrade', function () use ($vmName, $params) {
            // 停机
            $this->client->put("/1.0/instances/{$vmName}/state", [
                'action'  => 'stop',
                'timeout' => 60,
                'force'   => false,
            ]);

            // 修改配置
            $this->client->patch("/1.0/instances/{$vmName}", [
                'config' => [
                    'limits.cpu'    => (string)$params['cpu'],
                    'limits.memory' => $params['memory'] . 'GiB',
                ],
            ]);

            // 启动
            $result = $this->client->put("/1.0/instances/{$vmName}/state", [
                'action'  => 'start',
                'timeout' => 60,
            ]);

            AuditLogger::success('downgrade', $vmName, $params['order_id'] ?? null, [
                'cpu'    => $params['cpu'],
                'memory' => $params['memory'],
            ]);

            return $result;
        });
    }

    // ========================================================
    //  防火墙 ACL
    // ========================================================

    public function getFirewallRules($params)
    {
        $aclName = 'acl-' . $params['vm_name'];
        return $this->client->get("/1.0/network-acls/{$aclName}");
    }

    public function addFirewallRule($params)
    {
        $aclName = 'acl-' . $params['vm_name'];

        $result = $this->client->patch("/1.0/network-acls/{$aclName}", [
            $params['direction'] => $params['rules'],
        ]);

        AuditLogger::success('add_firewall_rule', $params['vm_name'], $params['order_id'] ?? null, [
            'direction' => $params['direction'],
        ]);

        return $result;
    }

    public function removeFirewallRule($params)
    {
        $aclName = 'acl-' . $params['vm_name'];

        $result = $this->client->patch("/1.0/network-acls/{$aclName}", [
            $params['direction'] => $params['rules'],
        ]);

        AuditLogger::success('remove_firewall_rule', $params['vm_name'], $params['order_id'] ?? null, [
            'direction' => $params['direction'],
        ]);

        return $result;
    }

    // ========================================================
    //  附加磁盘
    // ========================================================

    public function addDisk($params)
    {
        $vmName = $params['vm_name'];
        $volName = 'vol-' . $vmName . '-' . time();
        $size = $params['size'] ?? '50';
        $pool = $this->config['storage_pool'];

        return VmOperationLock::withLock($vmName, 'add_disk', function () use ($vmName, $volName, $size, $pool, $params) {
            // 创建存储卷
            $this->client->post("/1.0/storage-pools/{$pool}/volumes/custom", [
                'name'   => $volName,
                'config' => ['size' => "{$size}GiB"],
            ]);

            // 挂载到 VM
            $deviceName = 'data-' . $volName;
            $result = $this->client->patch("/1.0/instances/{$vmName}", [
                'devices' => [
                    $deviceName => [
                        'type'   => 'disk',
                        'pool'   => $pool,
                        'source' => $volName,
                    ],
                ],
            ]);

            AuditLogger::success('add_disk', $vmName, $params['order_id'] ?? null, [
                'volume' => $volName,
                'size'   => $size,
            ]);

            return array_merge($result, [
                'volume_name' => $volName,
                'note'        => 'VM 内需手动格式化挂载新磁盘',
            ]);
        });
    }

    public function removeDisk($params)
    {
        $vmName = $params['vm_name'];
        $deviceName = $params['device_name'];
        $volName = $params['volume_name'];
        $pool = $this->config['storage_pool'];

        return VmOperationLock::withLock($vmName, 'remove_disk', function () use ($vmName, $deviceName, $volName, $pool, $params) {
            // 从 VM 移除设备
            $instance = $this->client->get("/1.0/instances/{$vmName}");
            $devices = $instance['metadata']['devices'] ?? [];
            unset($devices[$deviceName]);

            $this->client->put("/1.0/instances/{$vmName}", [
                'devices' => $devices,
            ]);

            // 删除存储卷
            $result = $this->client->delete("/1.0/storage-pools/{$pool}/volumes/custom/{$volName}");

            AuditLogger::success('remove_disk', $vmName, $params['order_id'] ?? null, [
                'volume' => $volName,
            ]);

            return $result;
        });
    }

    // ========================================================
    //  监控
    // ========================================================

    public function getMetrics($params)
    {
        $vmName = $params['vm_name'];
        return $this->client->get("/1.0/instances/{$vmName}/state");
    }

    // ========================================================
    //  内部方法
    // ========================================================

    /**
     * 构建 cloud-init 配置
     */
    private function buildCloudInit(
        string $hostname,
        string $password,
        string $ip,
        string $gateway,
        string $netmask,
        array $sshKeys = []
    ): string {
        $cidr = $this->netmaskToCidr($netmask);

        $cloudInit = [
            'hostname'         => $hostname,
            'manage_etc_hosts' => true,
            'chpasswd'         => [
                'expire' => false,
                'users'  => [
                    ['name' => 'root', 'password' => $password, 'type' => 'text'],
                ],
            ],
            'ssh_pwauth'    => true,
            'disable_root'  => false,
        ];

        if (!empty($sshKeys)) {
            $cloudInit['ssh_authorized_keys'] = $sshKeys;
        }

        $netplanConfig = [
            'network' => [
                'version'   => 2,
                'renderer'  => 'networkd',
                'ethernets' => [
                    'enp5s0' => [
                        'addresses'   => ["{$ip}/{$cidr}"],
                        'routes'      => [['to' => 'default', 'via' => $gateway]],
                        'nameservers' => ['addresses' => ['1.1.1.1', '8.8.8.8']],
                    ],
                ],
            ],
        ];

        $cloudInit['write_files'] = [
            [
                'path'    => '/etc/netplan/50-static.yaml',
                'content' => yaml_emit($netplanConfig, YAML_UTF8_ENCODING, YAML_LN_BREAK),
            ],
        ];

        $cloudInit['runcmd'] = [
            ['netplan', 'apply'],
        ];

        return "#cloud-config\n" . yaml_emit($cloudInit, YAML_UTF8_ENCODING, YAML_LN_BREAK);
    }

    private function netmaskToCidr(string $netmask): int
    {
        return (int)array_sum(array_map(function ($octet) {
            return substr_count(decbin((int)$octet), '1');
        }, explode('.', $netmask)));
    }
}
