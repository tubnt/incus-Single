<?php

namespace App\Extensions\Incus;

use Illuminate\Support\Facades\Log;

/**
 * Incus REST API mTLS 客户端
 *
 * 通过 mTLS 证书连接 Incus 集群 API，自动附加 project 参数，
 * 支持异步操作等待、超时重试。
 */
class IncusClient
{
    private string $endpoint;
    private string $certFile;
    private string $keyFile;
    private string $caFile;
    private string $project;
    private int $timeout;
    private int $maxRetries;

    public function __construct(array $config)
    {
        $this->endpoint = rtrim($config['endpoint'], '/');
        $this->certFile = $config['cert_file'];
        $this->keyFile = $config['key_file'];
        $this->caFile = $config['ca_file'] ?? '';
        $this->project = $config['project'] ?? 'customers';
        $this->timeout = $config['timeout'] ?? 30;
        $this->maxRetries = $config['max_retries'] ?? 3;

        // 快速失败：启动时校验 mTLS 证书文件存在性，避免运行时才报 cURL 错误
        foreach (['cert_file' => $this->certFile, 'key_file' => $this->keyFile] as $name => $path) {
            if (!is_file($path)) {
                throw new \RuntimeException("Incus mTLS 证书文件不存在: {$name} = {$path}");
            }
        }
        if ($this->caFile !== '' && !is_file($this->caFile)) {
            throw new \RuntimeException("Incus CA 证书文件不存在: ca_file = {$this->caFile}");
        }
    }

    /**
     * GET 请求
     */
    public function get(string $path, array $query = []): array
    {
        return $this->request('GET', $path, [], $query);
    }

    /**
     * POST 请求
     */
    public function post(string $path, array $data = []): array
    {
        return $this->request('POST', $path, $data);
    }

    /**
     * PUT 请求
     */
    public function put(string $path, array $data = []): array
    {
        return $this->request('PUT', $path, $data);
    }

    /**
     * PATCH 请求
     */
    public function patch(string $path, array $data = []): array
    {
        return $this->request('PATCH', $path, $data);
    }

    /**
     * DELETE 请求
     */
    public function delete(string $path): array
    {
        return $this->request('DELETE', $path);
    }

    /**
     * 发送请求并自动处理异步操作
     *
     * Incus 对写操作返回 operation 对象，需要 poll 等待完成。
     */
    public function request(string $method, string $path, array $data = [], array $query = []): array
    {
        $query['project'] = $this->project;
        $url = $this->endpoint . $path . '?' . http_build_query($query);

        // 仅对幂等方法（GET/PUT/DELETE）重试，POST/PATCH 不重试防止重复操作
        $isIdempotent = in_array($method, ['GET', 'PUT', 'DELETE']);
        $maxAttempts = $isIdempotent ? $this->maxRetries : 1;

        $attempt = 0;
        $lastException = null;

        while ($attempt < $maxAttempts) {
            $attempt++;
            try {
                $response = $this->doRequest($method, $url, $data);

                // 异步操作：type=async 时需要等待完成
                if (isset($response['type']) && $response['type'] === 'async') {
                    return $this->waitForOperation($response['operation']);
                }

                return $response;
            } catch (\RuntimeException $e) {
                $lastException = $e;
                Log::warning('Incus API 请求失败', [
                    'method' => $method,
                    'path' => $path,
                    'attempt' => $attempt,
                    'error' => $e->getMessage(),
                ]);

                if ($attempt < $maxAttempts) {
                    // 指数退避：1s, 2s, 4s...
                    usleep(pow(2, $attempt - 1) * 1000000);
                }
            }
        }

        $retryMsg = $maxAttempts > 1
            ? "Incus API 请求失败，已重试 {$maxAttempts} 次: "
            : "Incus API 请求失败: ";

        throw new \RuntimeException(
            $retryMsg . $lastException->getMessage(),
            0,
            $lastException
        );
    }

    /**
     * 等待异步操作完成
     */
    private function waitForOperation(string $operationUrl): array
    {
        // 使用 Incus 的 wait 端点，带超时
        $waitPath = $operationUrl . '/wait';
        $url = $this->endpoint . $waitPath . '?' . http_build_query([
            'project' => $this->project,
            'timeout' => $this->timeout,
        ]);

        $response = $this->doRequest('GET', $url);

        $status = $response['metadata']['status'] ?? 'Unknown';
        if ($status !== 'Success') {
            $errMsg = $response['metadata']['err'] ?? "操作状态: {$status}";
            throw new \RuntimeException("Incus 异步操作未成功: {$errMsg}");
        }

        return $response;
    }

    /**
     * 执行 cURL 请求（mTLS）
     */
    private function doRequest(string $method, string $url, array $data = []): array
    {
        $ch = curl_init();

        $curlOpts = [
            CURLOPT_URL => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $this->timeout,
            CURLOPT_CONNECTTIMEOUT => 10,

            // mTLS 证书
            CURLOPT_SSLCERT => $this->certFile,
            CURLOPT_SSLKEY => $this->keyFile,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,

            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Accept: application/json',
            ],
        ];

        // 仅在指定 CA 文件时设置，避免空字符串导致验证行为不确定
        if ($this->caFile !== '') {
            $curlOpts[CURLOPT_CAINFO] = $this->caFile;
        }

        curl_setopt_array($ch, $curlOpts);

        if (!empty($data) && in_array($method, ['POST', 'PUT', 'PATCH'])) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
        }

        $responseBody = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        $curlErrno = curl_errno($ch);
        curl_close($ch);

        if ($curlErrno !== 0) {
            throw new \RuntimeException("cURL 错误 [{$curlErrno}]: {$curlError}");
        }

        $decoded = json_decode($responseBody, true);
        if ($decoded === null) {
            throw new \RuntimeException("Incus API 返回无效 JSON，HTTP {$httpCode}: {$responseBody}");
        }

        if ($httpCode >= 400) {
            $errMsg = $decoded['error'] ?? "HTTP {$httpCode}";
            Log::error('Incus API 错误', [
                'method' => $method,
                'path' => parse_url($url, PHP_URL_PATH),
                'http_code' => $httpCode,
                'error' => $errMsg,
            ]);
            throw new \RuntimeException("Incus API 错误: {$errMsg}");
        }

        return $decoded;
    }
}
