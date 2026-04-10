@extends('layouts.app')

@section('title', '对象存储')

@section('content')
    <div class="container mx-auto px-4 py-6">
        {{-- 消息提示 --}}
        @if(session('success'))
            <div class="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
                {{ session('success') }}
            </div>
        @endif
        @if(session('error'))
            <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                {{ session('error') }}
            </div>
        @endif

        {{-- 账户信息 --}}
        <div class="bg-white shadow rounded-lg p-6 mb-6">
            <h2 class="text-xl font-semibold mb-4">S3 对象存储</h2>

            @if(isset($credentials))
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-500">S3 Endpoint</label>
                        <div class="mt-1 flex items-center">
                            <code class="bg-gray-100 px-3 py-1 rounded text-sm flex-1">{{ $credentials['endpoint'] }}</code>
                            <button onclick="copyToClipboard('{{ $credentials['endpoint'] }}')"
                                    class="ml-2 text-blue-600 hover:text-blue-800 text-sm">复制</button>
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-500">Access Key</label>
                        <div class="mt-1 flex items-center">
                            <code class="bg-gray-100 px-3 py-1 rounded text-sm flex-1">{{ $credentials['access_key'] }}</code>
                            <button onclick="copyToClipboard('{{ $credentials['access_key'] }}')"
                                    class="ml-2 text-blue-600 hover:text-blue-800 text-sm">复制</button>
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-500">Secret Key</label>
                        <div class="mt-1 flex items-center">
                            <code id="secret-key" class="bg-gray-100 px-3 py-1 rounded text-sm flex-1">••••••••••••••••</code>
                            <button onclick="toggleSecret()" class="ml-2 text-blue-600 hover:text-blue-800 text-sm"
                                    id="toggle-secret-btn">显示</button>
                            <button onclick="copyToClipboard('{{ $credentials['secret_key'] }}')"
                                    class="ml-2 text-blue-600 hover:text-blue-800 text-sm">复制</button>
                        </div>
                    </div>
                </div>

                {{-- 用量统计 --}}
                @if(isset($usage))
                    <div class="border-t pt-4 mt-4">
                        <h3 class="text-sm font-medium text-gray-500 mb-3">用量概览</h3>
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div class="bg-gray-50 rounded p-3 text-center">
                                <div class="text-2xl font-bold text-blue-600">{{ $usage['buckets_used'] }}</div>
                                <div class="text-xs text-gray-500">桶 / {{ $usage['max_buckets'] }}</div>
                            </div>
                            <div class="bg-gray-50 rounded p-3 text-center">
                                <div class="text-2xl font-bold text-blue-600">{{ $usage['num_objects'] }}</div>
                                <div class="text-xs text-gray-500">对象数</div>
                            </div>
                            <div class="bg-gray-50 rounded p-3 text-center">
                                <div class="text-2xl font-bold text-blue-600">{{ $formattedSize }}</div>
                                <div class="text-xs text-gray-500">已用空间</div>
                            </div>
                            <div class="bg-gray-50 rounded p-3 text-center">
                                <div class="text-2xl font-bold {{ $usage['quota_percent'] > 80 ? 'text-red-600' : 'text-green-600' }}">
                                    {{ $usage['quota_percent'] }}%
                                </div>
                                <div class="text-xs text-gray-500">配额使用率</div>
                            </div>
                        </div>
                    </div>
                @endif
            @else
                {{-- 未开通 --}}
                <div class="text-center py-8">
                    <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    <h3 class="mt-2 text-sm font-medium text-gray-900">尚未开通对象存储</h3>
                    <p class="mt-1 text-sm text-gray-500">开通后可获得 S3 兼容的对象存储服务</p>
                    <form method="POST" action="{{ route('object-storage.create') }}" class="mt-4">
                        @csrf
                        <button type="submit"
                                class="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700">
                            开通对象存储
                        </button>
                    </form>
                </div>
            @endif
        </div>

        {{-- 存储桶列表 --}}
        @if(isset($credentials))
            <div class="bg-white shadow rounded-lg p-6">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold">存储桶</h2>
                    <button onclick="openCreateBucketModal()"
                            class="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700">
                        创建桶
                    </button>
                </div>

                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">桶名称</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">对象数</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">大小</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">创建时间</th>
                            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        @forelse($buckets as $bucket)
                            <tr>
                                <td class="px-6 py-4 whitespace-nowrap">
                                    <span class="text-sm font-medium text-gray-900">{{ $bucket['name'] }}</span>
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {{ number_format($bucket['num_objects'] ?? 0) }}
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {{ \App\Extensions\Incus\ObjectStorageManager::formatBytes($bucket['size_bytes'] ?? 0) }}
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {{ $bucket['created_at'] ?? '-' }}
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap text-right">
                                    <form method="POST" action="{{ route('object-storage.delete-bucket') }}"
                                          onsubmit="return confirm('确定要删除存储桶「{{ $bucket['name'] }}」吗？桶内对象将一并删除。')">
                                        @csrf
                                        @method('DELETE')
                                        <input type="hidden" name="bucket" value="{{ $bucket['name'] }}">
                                        <button type="submit"
                                                class="text-red-600 hover:text-red-800 text-sm font-medium">删除</button>
                                    </form>
                                </td>
                            </tr>
                        @empty
                            <tr>
                                <td colspan="5" class="px-6 py-8 text-center text-sm text-gray-500">
                                    暂无存储桶，点击「创建桶」开始使用
                                </td>
                            </tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
        @endif
    </div>

    {{-- 创建桶弹窗 --}}
    <div id="create-bucket-modal" class="fixed inset-0 bg-black bg-opacity-50 hidden z-50 flex items-center justify-center">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <div class="flex justify-between items-center px-6 py-4 border-b">
                <h3 class="text-lg font-semibold">创建存储桶</h3>
                <button onclick="closeCreateBucketModal()" class="text-gray-400 hover:text-gray-600">&times;</button>
            </div>
            <form method="POST" action="{{ route('object-storage.create-bucket') }}" id="create-bucket-form">
                @csrf
                <div class="px-6 py-4">
                    <label class="block text-sm font-medium text-gray-700 mb-1">桶名称</label>
                    <input type="text" name="bucket_name" id="bucket-name-input"
                           class="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500"
                           required minlength="3" maxlength="63"
                           pattern="^[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]$"
                           placeholder="my-bucket-name">
                    <p class="mt-1 text-xs text-gray-500">3-63 位小写字母、数字或连字符，不以连字符开头/结尾</p>
                </div>
                <div class="px-6 py-3 bg-gray-50 rounded-b-lg flex justify-end space-x-3">
                    <button type="button" onclick="closeCreateBucketModal()"
                            class="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md">取消</button>
                    <button type="submit"
                            class="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700">创建</button>
                </div>
            </form>
        </div>
    </div>

    <script>
        function openCreateBucketModal() {
            document.getElementById('create-bucket-modal').classList.remove('hidden');
            document.getElementById('bucket-name-input').focus();
        }

        function closeCreateBucketModal() {
            document.getElementById('create-bucket-modal').classList.add('hidden');
            document.getElementById('bucket-name-input').value = '';
        }

        document.getElementById('create-bucket-modal').addEventListener('click', function(e) {
            if (e.target === this) closeCreateBucketModal();
        });

        function toggleSecret() {
            var el = document.getElementById('secret-key');
            var btn = document.getElementById('toggle-secret-btn');
            if (el.dataset.visible === 'true') {
                el.textContent = '••••••••••••••••';
                el.dataset.visible = 'false';
                btn.textContent = '显示';
            } else {
                el.textContent = @json($credentials['secret_key'] ?? '');
                el.dataset.visible = 'true';
                btn.textContent = '隐藏';
            }
        }

        function copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(function() {
                var msg = document.createElement('div');
                msg.className = 'fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded shadow z-50';
                msg.textContent = '已复制';
                document.body.appendChild(msg);
                setTimeout(function() { msg.remove(); }, 2000);
            });
        }
    </script>
@endsection
