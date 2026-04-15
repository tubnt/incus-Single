<?php

namespace Paymenter\Extensions\Servers\Incus;

use App\Attributes\ExtensionMeta;
use App\Classes\Extension\Server;
use App\Models\Service;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

#[ExtensionMeta(
    name: 'Incus',
    description: 'Provision and manage VMs on Incus clusters via REST API (mTLS)',
    version: '1.0.0',
    author: 'IncusCloud',
)]
class Incus extends Server
{
    public function getConfig($values = [])
    {
        return [
            [
                'name' => 'api_url',
                'label' => 'Incus API URL',
                'type' => 'text',
                'default' => 'https://10.0.20.1:8443',
                'description' => 'Incus REST API endpoint (e.g. https://10.0.20.1:8443)',
                'required' => true,
            ],
            [
                'name' => 'cert_path',
                'label' => 'Client Certificate Path',
                'type' => 'text',
                'default' => '/var/www/html/certs/client.crt',
                'required' => true,
            ],
            [
                'name' => 'key_path',
                'label' => 'Client Key Path',
                'type' => 'text',
                'default' => '/var/www/html/certs/client.key',
                'required' => true,
            ],
            [
                'name' => 'ca_path',
                'label' => 'CA Certificate Path',
                'type' => 'text',
                'default' => '/var/www/html/certs/ca.crt',
                'required' => false,
            ],
            [
                'name' => 'project',
                'label' => 'Incus Project',
                'type' => 'text',
                'default' => 'customers',
                'required' => true,
            ],
            [
                'name' => 'storage_pool',
                'label' => 'Storage Pool',
                'type' => 'text',
                'default' => 'ceph-pool',
                'required' => true,
            ],
            [
                'name' => 'network',
                'label' => 'Network (bridge)',
                'type' => 'text',
                'default' => 'br-pub',
                'required' => true,
            ],
            [
                'name' => 'ip_range',
                'label' => 'IP Range (comma separated)',
                'type' => 'text',
                'default' => '202.151.179.234,202.151.179.235,202.151.179.236,202.151.179.237,202.151.179.238,202.151.179.239,202.151.179.240',
                'description' => 'Available public IPs for VMs',
                'required' => true,
            ],
            [
                'name' => 'gateway',
                'label' => 'Gateway IP',
                'type' => 'text',
                'default' => '202.151.179.225',
                'required' => true,
            ],
            [
                'name' => 'subnet_mask',
                'label' => 'Subnet CIDR',
                'type' => 'text',
                'default' => '27',
                'required' => true,
            ],
        ];
    }

    public function getProductConfig($values = [])
    {
        return [
            [
                'name' => 'cpu',
                'label' => 'vCPU Cores',
                'type' => 'text',
                'default' => '2',
                'required' => true,
            ],
            [
                'name' => 'memory',
                'label' => 'Memory (e.g. 2GiB)',
                'type' => 'text',
                'default' => '2GiB',
                'required' => true,
            ],
            [
                'name' => 'disk',
                'label' => 'Disk Size (e.g. 50GiB)',
                'type' => 'text',
                'default' => '50GiB',
                'required' => true,
            ],
            [
                'name' => 'image',
                'label' => 'OS Image',
                'type' => 'text',
                'default' => 'images:ubuntu/24.04/cloud',
                'required' => true,
            ],
        ];
    }

    public function createServer(Service $service, $settings = [], $properties = [])
    {
        $vmName = 'vm-' . $service->id;
        $cpu = $settings['cpu'] ?? '2';
        $memory = $settings['memory'] ?? '2GiB';
        $disk = $settings['disk'] ?? '50GiB';
        $image = $settings['image'] ?? 'images:ubuntu/24.04/cloud';

        $ip = $this->allocateIp($service);
        if (!$ip) {
            throw new \Exception('No available IP addresses in pool');
        }

        $gateway = $this->config('gateway');
        $cidr = $this->config('subnet_mask');
        $pool = $this->config('storage_pool');
        $network = $this->config('network');
        $project = $this->config('project');

        $password = bin2hex(random_bytes(12));

        $cloudInit = "#cloud-config\npassword: {$password}\nchpasswd:\n  expire: false\nssh_pwauth: true\npackages:\n  - curl";

        $networkConfig = "version: 2\nethernets:\n  enp5s0:\n    addresses:\n      - {$ip}/{$cidr}\n    routes:\n      - to: default\n        via: {$gateway}\n    nameservers:\n      addresses:\n        - 1.1.1.1\n        - 8.8.8.8";

        $body = [
            'name' => $vmName,
            'type' => 'virtual-machine',
            'source' => [
                'type' => 'image',
                'alias' => str_replace('images:', '', $image),
                'server' => 'https://images.linuxcontainers.org',
                'protocol' => 'simplestreams',
            ],
            'config' => [
                'limits.cpu' => $cpu,
                'limits.memory' => $memory,
                'user.cloud-init' => $cloudInit,
                'cloud-init.network-config' => $networkConfig,
                'security.secureboot' => 'false',
            ],
            'devices' => [
                'root' => [
                    'type' => 'disk',
                    'pool' => $pool,
                    'path' => '/',
                    'size' => $disk,
                ],
                'eth0' => [
                    'type' => 'nic',
                    'nictype' => 'bridged',
                    'parent' => $network,
                    'ipv4.address' => $ip,
                    'security.ipv4_filtering' => 'true',
                    'security.mac_filtering' => 'true',
                ],
            ],
        ];

        $response = $this->api('POST', "/1.0/instances?project={$project}", $body);

        if (!empty($response['error'])) {
            Log::error('Incus createServer failed', ['response' => $response, 'vm' => $vmName]);
            throw new \Exception('Failed to create VM: ' . $response['error']);
        }

        if (isset($response['metadata']['id'])) {
            $this->waitForOperation($response['metadata']['id'], $project);
        }

        $startResponse = $this->api('PUT', "/1.0/instances/{$vmName}/state?project={$project}", [
            'action' => 'start',
            'timeout' => 60,
        ]);

        if (isset($startResponse['metadata']['id'])) {
            $this->waitForOperation($startResponse['metadata']['id'], $project);
        }

        $service->properties()->updateOrCreate(
            ['key' => 'vm_name'],
            ['name' => 'VM Name', 'key' => 'vm_name', 'value' => $vmName]
        );
        $service->properties()->updateOrCreate(
            ['key' => 'vm_ip'],
            ['name' => 'IP Address', 'key' => 'vm_ip', 'value' => $ip]
        );
        $service->properties()->updateOrCreate(
            ['key' => 'vm_password'],
            ['name' => 'Password', 'key' => 'vm_password', 'value' => $password]
        );

        return true;
    }

    public function suspendServer(Service $service, $settings = [], $properties = [])
    {
        $vmName = $service->properties->where('key', 'vm_name')->first()?->value ?? 'vm-' . $service->id;
        $project = $this->config('project');

        $this->api('PUT', "/1.0/instances/{$vmName}/state?project={$project}", [
            'action' => 'freeze',
            'timeout' => 30,
        ]);

        return true;
    }

    public function unsuspendServer(Service $service, $settings = [], $properties = [])
    {
        $vmName = $service->properties->where('key', 'vm_name')->first()?->value ?? 'vm-' . $service->id;
        $project = $this->config('project');

        $this->api('PUT', "/1.0/instances/{$vmName}/state?project={$project}", [
            'action' => 'unfreeze',
            'timeout' => 30,
        ]);

        return true;
    }

    public function terminateServer(Service $service, $settings = [], $properties = [])
    {
        $vmName = $service->properties->where('key', 'vm_name')->first()?->value ?? 'vm-' . $service->id;
        $project = $this->config('project');

        $this->api('PUT', "/1.0/instances/{$vmName}/state?project={$project}", [
            'action' => 'stop',
            'timeout' => 30,
            'force' => true,
        ]);

        sleep(3);

        $this->api('DELETE', "/1.0/instances/{$vmName}?project={$project}");

        $this->releaseIp($service);

        return true;
    }

    public function getActions(Service $service, $settings = [], $properties = [])
    {
        $vmName = $service->properties->where('key', 'vm_name')->first()?->value ?? 'vm-' . $service->id;
        $vmIp = $service->properties->where('key', 'vm_ip')->first()?->value ?? '-';
        $vmPass = $service->properties->where('key', 'vm_password')->first()?->value ?? '-';

        $actions = [
            [
                'type' => 'text',
                'name' => 'hostname',
                'label' => 'Hostname',
                'text' => $vmName,
            ],
            [
                'type' => 'text',
                'name' => 'ip_address',
                'label' => 'IP Address',
                'text' => $vmIp,
            ],
            [
                'type' => 'text',
                'name' => 'username',
                'label' => 'Username',
                'text' => 'ubuntu',
            ],
            [
                'type' => 'text',
                'name' => 'password',
                'label' => 'Password',
                'text' => $vmPass,
            ],
            [
                'type' => 'button',
                'name' => 'start',
                'label' => 'Start',
                'function' => 'actionStart',
            ],
            [
                'type' => 'button',
                'name' => 'stop',
                'label' => 'Stop',
                'function' => 'actionStop',
            ],
            [
                'type' => 'button',
                'name' => 'restart',
                'label' => 'Restart',
                'function' => 'actionRestart',
            ],
        ];

        return $actions;
    }

    public function actionStart(Service $service, $settings = [], $properties = [])
    {
        $vmName = $service->properties->where('key', 'vm_name')->first()?->value ?? 'vm-' . $service->id;
        $project = $this->config('project');

        $this->api('PUT', "/1.0/instances/{$vmName}/state?project={$project}", [
            'action' => 'start',
            'timeout' => 60,
        ]);

        return true;
    }

    public function actionStop(Service $service, $settings = [], $properties = [])
    {
        $vmName = $service->properties->where('key', 'vm_name')->first()?->value ?? 'vm-' . $service->id;
        $project = $this->config('project');

        $this->api('PUT', "/1.0/instances/{$vmName}/state?project={$project}", [
            'action' => 'stop',
            'timeout' => 30,
        ]);

        return true;
    }

    public function actionRestart(Service $service, $settings = [], $properties = [])
    {
        $vmName = $service->properties->where('key', 'vm_name')->first()?->value ?? 'vm-' . $service->id;
        $project = $this->config('project');

        $this->api('PUT', "/1.0/instances/{$vmName}/state?project={$project}", [
            'action' => 'restart',
            'timeout' => 60,
        ]);

        return true;
    }

    private function api(string $method, string $path, array $body = []): array
    {
        $url = rtrim($this->config('api_url'), '/') . $path;
        $certPath = $this->config('cert_path');
        $keyPath = $this->config('key_path');
        $caPath = $this->config('ca_path');

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 120,
            CURLOPT_SSLCERT => $certPath,
            CURLOPT_SSLKEY => $keyPath,
            CURLOPT_SSL_VERIFYPEER => !empty($caPath),
            CURLOPT_CAINFO => $caPath ?: '',
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        ]);

        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);

        switch (strtoupper($method)) {
            case 'POST':
                curl_setopt($ch, CURLOPT_POST, true);
                curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
                break;
            case 'PUT':
                curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PUT');
                curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
                break;
            case 'PATCH':
                curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PATCH');
                curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
                break;
            case 'DELETE':
                curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'DELETE');
                break;
        }

        $result = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($error) {
            Log::error('Incus API curl error', ['error' => $error, 'url' => $url]);
            return ['error' => $error];
        }

        return json_decode($result, true) ?? ['error' => 'Invalid JSON response'];
    }

    private function waitForOperation(string $operationId, string $project, int $timeout = 120): void
    {
        $url = "/1.0/operations/{$operationId}/wait?timeout={$timeout}";
        if ($project) {
            $url .= "&project={$project}";
        }
        $this->api('GET', $url);
    }

    private function allocateIp(Service $service): ?string
    {
        $ipRange = $this->config('ip_range');
        $availableIps = array_map('trim', explode(',', $ipRange));

        $usedIps = \App\Models\Property::where('key', 'vm_ip')
            ->where('model_type', Service::class)
            ->pluck('value')
            ->toArray();

        foreach ($availableIps as $ip) {
            if (!in_array($ip, $usedIps)) {
                return $ip;
            }
        }

        return null;
    }

    private function releaseIp(Service $service): void
    {
        $service->properties()->where('key', 'vm_ip')->delete();
    }
}
