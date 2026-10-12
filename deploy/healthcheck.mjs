/**
 * 容器/主机通用的健康探针。
 *
 * 用途：
 *  1. Dockerfile 的 HEALTHCHECK 调用它，验证镜像内探针真的可执行（而不是从未运行过的字符串）；
 *  2. 运维可在容器外直接执行：node deploy/healthcheck.mjs http://127.0.0.1:8080
 *
 * 退出码：0 = 健康；1 = 不健康（连不上、超时、HTTP 非 2xx、响应不是 {"ok":true}）。
 */
const input = process.argv[2]
  || process.env.HEALTHCHECK_URL
  || `http://127.0.0.1:${process.env.PORT || 8787}/api/health`;

const target = new URL(input);
if (target.pathname === '/') target.pathname = '/api/health';
const url = target.href;

const timeoutMs = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 5000);
const startedAt = Date.now();

async function probe() {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json().catch(() => null);
  if (!body || body.ok !== true || body.data?.status !== 'ok') throw new Error('响应不是 {"ok":true}');
  return body?.data?.status || 'ok';
}

try {
  const status = await probe();
  process.stdout.write(`healthy: ${url} status=${status} ms=${Date.now() - startedAt}\n`);
  // 不要用 process.exit()：fetch 的 socket 可能尚未收尾，强制退出会在 Windows 上
  // 触发 libuv 断言（0xC0000409），导致明明健康却返回非 0 退出码，容器被判为 unhealthy。
  // 这里让事件循环自然结束，并同样通过 process.exitCode 表达结论。
  process.exitCode = 0;
} catch (error) {
  process.stdout.write(`unhealthy: ${url} reason=${error?.message || error} ms=${Date.now() - startedAt}\n`);
  process.exitCode = 1;
}
