<?php

namespace App\Extensions\Incus;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * 对象存储管理器（Ceph RGW S3 兼容）
 *
 * 功能：S3 用户管理、桶管理、凭据管理、用量查询、配额设置
 * 通过 radosgw-admin CLI 与 RGW Admin API 交互
 */
class ObjectStorageManager
{
    /** 默认用户配额（字节） — 50GB */
    private const DEFAULT_USER_QUOTA_BYTES = 53687091200;

    /** 默认桶配额（字节） — 10GB */
    private const DEFAULT_BUCKET_QUOTA_BYTES = 10737418240;

    /** 默认最大桶数 */
    private const DEFAULT_MAX_BUCKETS = 10;

    private string $adminEndpoint;
    private string $adminAccessKey;
    private string $adminSecretKey;
    private bool $sslVerify;

    public function __construct()
    {
        $this->adminEndpoint = config('incus.rgw.endpoint', 'https://s3.incus.local:7443');
        $this->adminAccessKey = config('incus.rgw.admin_access_key', '');
        $this->adminSecretKey = config('incus.rgw.admin_secret_key', '');
        $this->sslVerify = config('incus.rgw.ssl_verify', false);
    }

    // ==================== 用户管理 ====================

    /**
     * 创建 S3 用户
     *
     * @param int    $userId      平台用户 ID
     * @param string $displayName 显示名称
     * @param int    $quotaBytes  用户配额（字节），0 表示无限制
     * @return array{success: bool, message: string, credentials?: array}
     */
    public function createUser(int $userId, string $displayName, int $quotaBytes = 0): array
    {
        $uid = $this->generateUid($userId);

        // 检查是否已存在
        $existing = DB::table('incus_object_storage_users')
            ->where('user_id', $userId)
            ->first();

        if ($existing) {
            return [
                'success' => false,
                'message' => '该用户已拥有对象存储账户',
            ];
        }

        // 通过 radosgw-admin API 创建用户
        $result = $this->adminApiRequest('PUT', '/admin/user', [
            'uid'          => $uid,
            'display-name' => $displayName,
            'max-buckets'  => self::DEFAULT_MAX_BUCKETS,
        ]);

        if (!$result['success']) {
            Log::error('RGW 用户创建失败', [
                'user_id' => $userId,
                'uid'     => $uid,
                'error'   => $result['message'],
            ]);
            return $result;
        }

        $keys = $result['data']['keys'][0] ?? null;
        if (!$keys) {
            return ['success' => false, 'message' => '创建用户成功但未获取到凭据'];
        }

        // 设置配额
        $effectiveQuota = $quotaBytes > 0 ? $quotaBytes : self::DEFAULT_USER_QUOTA_BYTES;
        $this->setUserQuota($uid, $effectiveQuota);

        // 保存到数据库
        DB::table('incus_object_storage_users')->insert([
            'user_id'    => $userId,
            'rgw_uid'    => $uid,
            'access_key' => $keys['access_key'],
            'secret_key' => encrypt($keys['secret_key']),
            'quota_bytes' => $effectiveQuota,
            'max_buckets' => self::DEFAULT_MAX_BUCKETS,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Log::info('对象存储用户创建成功', ['user_id' => $userId, 'uid' => $uid]);

        return [
            'success'     => true,
            'message'     => '对象存储用户创建成功',
            'credentials' => [
                'access_key' => $keys['access_key'],
                'secret_key' => $keys['secret_key'],
                'endpoint'   => $this->adminEndpoint,
            ],
        ];
    }

    /**
     * 获取用户凭据
     *
     * @return array{success: bool, message: string, credentials?: array}
     */
    public function getCredentials(int $userId): array
    {
        $record = DB::table('incus_object_storage_users')
            ->where('user_id', $userId)
            ->first();

        if (!$record) {
            return ['success' => false, 'message' => '未找到对象存储账户'];
        }

        return [
            'success'     => true,
            'message'     => '获取凭据成功',
            'credentials' => [
                'access_key' => $record->access_key,
                'secret_key' => decrypt($record->secret_key),
                'endpoint'   => $this->adminEndpoint,
                'rgw_uid'    => $record->rgw_uid,
            ],
        ];
    }

    // ==================== 桶管理 ====================

    /**
     * 创建存储桶
     *
     * @return array{success: bool, message: string}
     */
    public function createBucket(int $userId, string $bucketName): array
    {
        // 验证桶名称
        if (!$this->validateBucketName($bucketName)) {
            return ['success' => false, 'message' => '桶名称不合法（3-63 位小写字母、数字、连字符）'];
        }

        $creds = $this->getCredentials($userId);
        if (!$creds['success']) {
            return $creds;
        }

        // 检查桶数量限制
        $record = DB::table('incus_object_storage_users')
            ->where('user_id', $userId)
            ->first();

        $currentBuckets = $this->listBuckets($userId);
        if ($currentBuckets['success'] && count($currentBuckets['buckets'] ?? []) >= $record->max_buckets) {
            return [
                'success' => false,
                'message' => "桶数量已达上限（{$record->max_buckets} 个）",
            ];
        }

        // 通过 S3 API 创建桶
        $result = $this->s3Request(
            'PUT',
            "/{$bucketName}",
            $creds['credentials']['access_key'],
            decrypt($record->secret_key)
        );

        if (!$result['success']) {
            Log::error('创建存储桶失败', [
                'user_id' => $userId,
                'bucket'  => $bucketName,
                'error'   => $result['message'],
            ]);
            return $result;
        }

        Log::info('存储桶创建成功', ['user_id' => $userId, 'bucket' => $bucketName]);

        return ['success' => true, 'message' => "存储桶 {$bucketName} 创建成功"];
    }

    /**
     * 删除存储桶
     *
     * @param bool $force 是否强制删除（包括桶内对象）
     * @return array{success: bool, message: string}
     */
    public function deleteBucket(int $userId, string $bucketName, bool $force = false): array
    {
        $creds = $this->getCredentials($userId);
        if (!$creds['success']) {
            return $creds;
        }

        // 验证桶归属
        $bucketInfo = $this->adminApiRequest('GET', '/admin/bucket', [
            'bucket' => $bucketName,
        ]);

        if ($bucketInfo['success'] && ($bucketInfo['data']['owner'] ?? '') !== $creds['credentials']['rgw_uid']) {
            return ['success' => false, 'message' => '无权操作此存储桶'];
        }

        if ($force) {
            // 强制删除（通过 admin API）
            $result = $this->adminApiRequest('DELETE', '/admin/bucket', [
                'bucket'       => $bucketName,
                'purge-objects' => 'true',
            ]);
        } else {
            // 普通删除（桶必须为空）
            $record = DB::table('incus_object_storage_users')
                ->where('user_id', $userId)
                ->first();
            $result = $this->s3Request(
                'DELETE',
                "/{$bucketName}",
                $creds['credentials']['access_key'],
                decrypt($record->secret_key)
            );
        }

        if (!$result['success']) {
            Log::error('删除存储桶失败', [
                'user_id' => $userId,
                'bucket'  => $bucketName,
                'error'   => $result['message'],
            ]);
            return $result;
        }

        Log::info('存储桶删除成功', ['user_id' => $userId, 'bucket' => $bucketName]);

        return ['success' => true, 'message' => "存储桶 {$bucketName} 已删除"];
    }

    /**
     * 列出用户的所有存储桶
     *
     * @return array{success: bool, message: string, buckets?: array}
     */
    public function listBuckets(int $userId): array
    {
        $record = DB::table('incus_object_storage_users')
            ->where('user_id', $userId)
            ->first();

        if (!$record) {
            return ['success' => false, 'message' => '未找到对象存储账户'];
        }

        $result = $this->adminApiRequest('GET', '/admin/bucket', [
            'uid' => $record->rgw_uid,
            'stats' => 'true',
        ]);

        if (!$result['success']) {
            return $result;
        }

        $buckets = [];
        foreach ($result['data'] as $bucket) {
            if (is_string($bucket)) {
                // 简单列表模式
                $buckets[] = ['name' => $bucket];
            } else {
                // 带统计信息
                $usage = $bucket['usage']['rgw.main'] ?? [];
                $buckets[] = [
                    'name'         => $bucket['bucket'] ?? $bucket['name'] ?? '',
                    'size_bytes'   => $usage['size_actual'] ?? 0,
                    'num_objects'  => $usage['num_objects'] ?? 0,
                    'created_at'   => $bucket['creation_time'] ?? null,
                ];
            }
        }

        return [
            'success' => true,
            'message' => '获取桶列表成功',
            'buckets' => $buckets,
        ];
    }

    // ==================== 用量与配额 ====================

    /**
     * 获取用户用量
     *
     * @return array{success: bool, message: string, usage?: array}
     */
    public function getUsage(int $userId): array
    {
        $record = DB::table('incus_object_storage_users')
            ->where('user_id', $userId)
            ->first();

        if (!$record) {
            return ['success' => false, 'message' => '未找到对象存储账户'];
        }

        // 获取用户统计
        $result = $this->adminApiRequest('GET', '/admin/user', [
            'uid'   => $record->rgw_uid,
            'stats' => 'true',
        ]);

        if (!$result['success']) {
            return $result;
        }

        $stats = $result['data']['stats'] ?? [];

        return [
            'success' => true,
            'message' => '获取用量成功',
            'usage'   => [
                'size_bytes'      => $stats['size_actual'] ?? 0,
                'num_objects'     => $stats['num_objects'] ?? 0,
                'quota_bytes'     => $record->quota_bytes,
                'quota_percent'   => $record->quota_bytes > 0
                    ? round(($stats['size_actual'] ?? 0) / $record->quota_bytes * 100, 2)
                    : 0,
                'max_buckets'     => $record->max_buckets,
                'buckets_used'    => count($this->listBuckets($userId)['buckets'] ?? []),
            ],
        ];
    }

    /**
     * 设置用户配额
     */
    private function setUserQuota(string $uid, int $quotaBytes): bool
    {
        $result = $this->adminApiRequest('PUT', '/admin/user', [
            'uid'            => $uid,
            'quota-type'     => 'user',
            'quota'          => '',
            'max-size'       => $quotaBytes,
            'enabled'        => 'true',
        ], '/quota');

        return $result['success'];
    }

    // ==================== 内部方法 ====================

    /**
     * 生成 RGW 用户 UID
     */
    private function generateUid(int $userId): string
    {
        return 'incus-user-' . $userId;
    }

    /**
     * 验证桶名称（S3 规范）
     */
    private function validateBucketName(string $name): bool
    {
        // 3-63 字符，小写字母/数字/连字符，不以连字符开头或结尾
        return (bool) preg_match('/^[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]$/', $name);
    }

    /**
     * RGW Admin API 请求
     *
     * @return array{success: bool, message: string, data?: array}
     */
    private function adminApiRequest(string $method, string $path, array $params = [], string $subResource = ''): array
    {
        $url = rtrim($this->adminEndpoint, '/') . $path . $subResource;

        if ($method === 'GET' || $method === 'DELETE') {
            $url .= '?' . http_build_query($params);
        }

        // 生成 AWS SigV4 签名
        $date = gmdate('D, d M Y H:i:s T');
        $stringToSign = "{$method}\n\n\n{$date}\n{$path}{$subResource}";
        $signature = base64_encode(hash_hmac('sha1', $stringToSign, $this->adminSecretKey, true));

        $headers = [
            "Date: {$date}",
            "Authorization: AWS {$this->adminAccessKey}:{$signature}",
            'Content-Type: application/json',
        ];

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_SSL_VERIFYPEER => $this->sslVerify,
            CURLOPT_SSL_VERIFYHOST => $this->sslVerify ? 2 : 0,
        ]);

        if ($method === 'PUT' || $method === 'POST') {
            curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($params));
        }

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($curlError) {
            return ['success' => false, 'message' => "RGW API 连接失败: {$curlError}"];
        }

        if ($httpCode >= 400) {
            $errorMsg = $response ?: "HTTP {$httpCode}";
            return ['success' => false, 'message' => "RGW API 错误: {$errorMsg}"];
        }

        $data = json_decode($response, true);

        return [
            'success' => true,
            'message' => '操作成功',
            'data'    => $data ?? [],
        ];
    }

    /**
     * S3 API 请求（用于桶操作）
     *
     * @return array{success: bool, message: string}
     */
    private function s3Request(string $method, string $path, string $accessKey, string $secretKey): array
    {
        $url = rtrim($this->adminEndpoint, '/') . $path;
        $date = gmdate('D, d M Y H:i:s T');
        $stringToSign = "{$method}\n\n\n{$date}\n{$path}";
        $signature = base64_encode(hash_hmac('sha1', $stringToSign, $secretKey, true));

        $headers = [
            "Date: {$date}",
            "Authorization: AWS {$accessKey}:{$signature}",
        ];

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_SSL_VERIFYPEER => $this->sslVerify,
            CURLOPT_SSL_VERIFYHOST => $this->sslVerify ? 2 : 0,
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($curlError) {
            return ['success' => false, 'message' => "S3 请求失败: {$curlError}"];
        }

        if ($httpCode >= 400) {
            return ['success' => false, 'message' => "S3 错误 (HTTP {$httpCode}): {$response}"];
        }

        return ['success' => true, 'message' => '操作成功'];
    }

    /**
     * 格式化字节数为可读字符串
     */
    public static function formatBytes(int $bytes, int $precision = 2): string
    {
        $units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        $index = 0;
        $size = (float) $bytes;

        while ($size >= 1024 && $index < count($units) - 1) {
            $size /= 1024;
            $index++;
        }

        return round($size, $precision) . ' ' . $units[$index];
    }
}
