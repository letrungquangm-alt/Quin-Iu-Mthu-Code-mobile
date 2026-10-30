// worker-failover-antigravity.js
// QuinloveRin 3.8 - Cloudflare Worker Failover Logic

// Biến môi trường cần khai báo trong Cloudflare Dashboard:
// ANTIGRAVITY_API_URL: URL của API chính (Antigravity)
// ANTIGRAVITY_API_KEY: Key của API chính
// BACKUP_CLOUD_API_URL: URL của API dự phòng (Cloud)
// BACKUP_CLOUD_API_KEY: Key của API dự phòng
// MAX_RETRIES: Số lần thử lại trước khi bỏ cuộc

const MAX_RETRIES = parseInt(env.MAX_RETRIES || '3');
const RETRY_DELAY_MS = 1000; // Chờ 1 giây trước khi retry/fallback

// Helper: Fetch với timeout
async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 10000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const result = await fetch(resource, {
    ...options,
    signal: controller.signal
  }).finally(() => clearTimeout(id));
  return result;
}

// Helper: Kiểm tra xem response có phải là lỗi cần fallback không
function shouldFallback(statusCode) {
  // 429: Too Many Requests (Limit)
  // 500-599: Server Errors
  return statusCode === 429 || (statusCode >= 500 && statusCode < 600);
}

// Function: Gọi API Antigravity
async function callAntigravity(payload) {
  const url = env.ANTIGRAVITY_API_URL;
  const key = env.ANTIGRAVITY_API_KEY;
  
  if (!url || !key) throw new Error('Antigravity config missing');

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify(payload)
  });

  return {
    status: response.status,
    data: await response.json(),
    source: 'antigravity'
  };
}

// Function: Gọi API Cloud Backup
async function callBackupCloud(payload) {
  const url = env.BACKUP_CLOUD_API_URL;
  const key = env.BACKUP_CLOUD_API_KEY;

  if (!url || !key) throw new Error('Backup Cloud config missing');

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify(payload)
  });

  return {
    status: response.status,
    data: await response.json(),
    source: 'backup_cloud'
  };
}

// Main Logic: Orchestrator
async function processRequest(payload) {
  let lastError = null;

  // 1. Thử gọi Antigravity
  try {
    const result = await callAntigravity(payload);
    
    // Nếu thành công (2xx), trả về ngay
    if (result.status >= 200 && result.status < 300) {
      console.log(`[INFO] Request succeeded via Antigravity`);
      return {
        success: true,
        data: result.data,
        provider: 'antigravity'
      };
    }

    // Nếu lỗi cần fallback (429, 5xx)
    if (shouldFallback(result.status)) {
      console.warn(`[WARN] Antigravity returned ${result.status}, initiating fallback to Backup Cloud...`);
      // Không throw ngay, mà rơi xuống phần fallback
    } else {
      // Lỗi khác (4xx như 400, 401...) thì không nên fallback, trả về lỗi luôn
      throw new Error(`Antigravity error: ${result.status} - ${JSON.stringify(result.data)}`);
    }

  } catch (err) {
    lastError = err;
    console.error(`[ERROR] Antigravity call failed: ${err.message}`);
  }

  // 2. Fallback sang Backup Cloud
  try {
    console.log(`[INFO] Switching to Backup Cloud provider...`);
    const result = await callBackupCloud(payload);

    if (result.status >= 200 && result.status < 300) {
      console.log(`[INFO] Request succeeded via Backup Cloud`);
      return {
        success: true,
        data: result.data,
        provider: 'backup_cloud',
        warning: 'Primary provider (Antigravity) was unreachable or rate-limited. Served by Backup.'
      };
    }

    // Nếu Backup cũng lỗi
    throw new Error(`Backup Cloud failed with status: ${result.status}`);

  } catch (err) {
    console.error(`[ERROR] Backup Cloud also failed: ${err.message}`);
    // Nếu cả hai đều hỏng
    return {
      success: false,
      error: 'All providers failed. Please try again later.',
      originalError: lastError?.message,
      backupError: err.message
    };
  }
}

// Cloudflare Worker Export
export default {
  async fetch(request, env, ctx) {
    // Chỉ chấp nhận POST
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    try {
      const payload = await request.json();
      
      // Gọi logic xử lý failover
      const result = await processRequest(payload, env);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Provider-Used': result.provider || 'unknown'
        }
      });

    } catch (err) {
      console.error(`[FATAL] Unhandled error: ${err.message}`);
      return new Response(JSON.stringify({
        success: false,
        error: 'Internal Server Error',
        details: err.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
