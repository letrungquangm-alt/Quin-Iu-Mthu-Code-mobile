/**
 * QuinloveRin 3.8 - Cloudflare Ping Test Worker
 * Mô tả: Worker đơn giản để test độ trễ và trạng thái hệ thống 24/7.
 * Quy tắc: Xưng hô "tôi - bro", không dùng "anh - em".
 */

export default {
  async fetch(request, env, ctx) {
    // Lấy thời gian bắt đầu để tính độ trễ xử lý
    const startTime = performance.now();

    // Xác định đường dẫn
    const url = new URL(request.url);
    const path = url.pathname;

    // Phản hồi JSON chuẩn cho các client ping
    const response = {
      status: "ok",
      message: "Ping test 24/7 Cloudflare - QuinloveRin 3.8",
      timestamp: new Date().toISOString(),
      worker: "QuinloveRin-3.8",
      environment: env.MY_VAR || "default",
      // Giả lập một tác vụ nhẹ để test CPU/IO
      dummyCompute: Math.random() * 1000,
    };

    // Tính độ trễ xử lý bên trong worker
    const endTime = performance.now();
    response.processingTimeMs = (endTime - startTime).toFixed(2);

    // Trả về response JSON
    return new Response(JSON.stringify(response, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        "X-Worker": "QuinloveRin-3.8",
        "X-Server-Location": "Cloudflare Edge",
      },
    });
  },
};
