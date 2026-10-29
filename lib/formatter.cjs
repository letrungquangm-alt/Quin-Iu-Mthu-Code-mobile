const path = require('path');
const fs = require('fs');
const { escapeHtml } = require('./telegram.cjs');

function formatToolCall(tc) {
    const fn = tc.function || tc;
    const toolName = fn.name;
    const args = fn.args || fn.arguments || {};
    const rawSummary = args.toolSummary ? args.toolSummary.toString().replace(/^"|"$/g, '') : '';
    let summary = '';
    let runningFn = null;
    let finishedFn = null;

    if (toolName === 'run_command') {
        const cmd = args.CommandLine ? args.CommandLine.toString().replace(/^"|"$/g, '').trim() : '';
        const safeCmd = escapeHtml(cmd.length > 200 ? cmd.substring(0, 200) + '... [dài]' : cmd);

        if (/(Remove-Item|rm\s+|del\s+|rmdir|unlink)/i.test(cmd)) {
            summary = rawSummary || 'Xóa file / thư mục';
            runningFn = (s) => `🔴 <b>[XÓA FILE / THƯ MỤC (${s}s)...]</b>\n<pre><code class="language-diff">- ${safeCmd}</code></pre>`;
            finishedFn = (s) => `🔴 <b>[ĐÃ XÓA FILE / THƯ MỤC XONG]</b>\n<pre><code class="language-diff">- ${safeCmd}</code></pre>\n<i>↳ ✅ Hoàn tất trong ${s}s</i>`;
        } else {
            summary = rawSummary || 'Chạy lệnh terminal';
            runningFn = (s) => `⚡ <b>[ĐANG XỬ LÝ (${s}s)...]</b>\n▶ <code>${escapeHtml(summary)}</code>\n<pre><code class="language-powershell">${safeCmd}</code></pre>`;
            finishedFn = (s) => `⚡ <b>[ĐÃ XỬ LÝ XONG]</b>\n▶ <code>${escapeHtml(summary)}</code>\n<pre><code class="language-powershell">${safeCmd}</code></pre>\n<i>↳ ✅ Hoàn tất trong ${s}s</i>`;
        }
    } else if (toolName === 'write_file') {
        const rawPath = args.Path ? args.Path.toString().replace(/^"|"$/g, '') : 'file';
        const fileName = path.basename(rawPath);
        const isOverwrite = args.Overwrite === true || args.Overwrite === 'true';
        const isAppend = args.Append === true || args.Append === 'true';
        let fileExisted = false;
        try { fileExisted = fs.existsSync(rawPath); } catch (e) {}
        const contentLines = args.Content ? args.Content.toString().split(/\r?\n/).length : 0;

        if (isOverwrite || isAppend || fileExisted) {
            summary = rawSummary || `Cập nhật file ${fileName}`;
            runningFn = (s) => `🟠 <b>[SỬA FILE (${s}s)...]:</b> <code>${fileName}</code>\n<pre><code class="language-diff">--- a/${fileName}\n- Ghi đè thay thế nội dung cũ\n+++ b/${fileName}\n+ ${contentLines} dòng thêm mới</code></pre>`;
            finishedFn = (s) => `🟠 <b>[ĐÃ SỬA XONG FILE]:</b> <code>${fileName}</code>\n<pre><code class="language-diff">--- a/${fileName}\n- Ghi đè thay thế nội dung cũ\n+++ b/${fileName}\n+ ${contentLines} dòng thêm mới</code></pre>\n<i>↳ ✅ Hoàn tất trong ${s}s</i>`;
        } else {
            summary = rawSummary || `Tạo mới file ${fileName}`;
            runningFn = (s) => `🟢 <b>[TẠO FILE MỚI (${s}s)...]:</b> <code>${fileName}</code>\n<pre><code class="language-diff">+++ b/${fileName}\n+ ${contentLines} dòng mã nguồn mới</code></pre>`;
            finishedFn = (s) => `🟢 <b>[ĐÃ TẠO XONG FILE]:</b> <code>${fileName}</code>\n<pre><code class="language-diff">+++ b/${fileName}\n+ ${contentLines} dòng mã nguồn mới</code></pre>\n<i>↳ ✅ Hoàn tất trong ${s}s</i>`;
        }
    } else if (toolName === 'edit_file') {
        const rawPath = args.Path ? args.Path.toString().replace(/^"|"$/g, '') : 'file';
        const fileName = path.basename(rawPath);
        const linesRemoved = args.Target ? args.Target.toString().split(/\r?\n/).length : 1;
        const linesAdded = args.Replacement ? args.Replacement.toString().split(/\r?\n/).length : 0;
        summary = rawSummary || `Chỉnh sửa code ${fileName}`;
        runningFn = (s) => `🟠 <b>[SỬA FILE (${s}s)...]:</b> <code>${fileName}</code>\n<pre><code class="language-diff">--- a/${fileName}\n- ${linesRemoved} dòng đã xóa\n+++ b/${fileName}\n+ ${linesAdded} dòng thêm</code></pre>`;
        finishedFn = (s) => `🟠 <b>[ĐÃ SỬA XONG FILE]:</b> <code>${fileName}</code>\n<pre><code class="language-diff">--- a/${fileName}\n- ${linesRemoved} dòng đã xóa\n+++ b/${fileName}\n+ ${linesAdded} dòng thêm</code></pre>\n<i>↳ ✅ Hoàn tất trong ${s}s</i>`;
    } else if (toolName === 'read_file') {
        const rawPath = args.Path ? args.Path.toString().replace(/^"|"$/g, '') : 'file';
        const fileName = path.basename(rawPath);
        if (/\.(jpg|jpeg|png|webp|gif)$/i.test(fileName)) {
            summary = rawSummary || `Phân tích hình ảnh ${fileName}`;
            runningFn = (s) => `🖼️ <b>[PHÂN TÍCH HÌNH ẢNH (${s}s)...]:</b> <code>${fileName}</code>`;
            finishedFn = (s) => `🖼️ <b>[ĐÃ PHÂN TÍCH HÌNH ẢNH XONG]:</b> <code>${fileName}</code>\n<i>↳ ✅ Hoàn tất trong ${s}s</i>`;
        } else {
            // Không spam bong bóng riêng cho các lần đọc file thông thường
            summary = `Đang đọc ${fileName}`;
            runningFn = null;
            finishedFn = null;
        }
    } else if (toolName === 'manage_task' || toolName === 'list_plugin_accounts') {
        summary = 'Kiểm tra tiến trình';
        runningFn = null;
        finishedFn = null;
    } else {
        summary = rawSummary || `Xử lý ${toolName}`;
        runningFn = (s) => `⚡ <b>[ĐANG XỬ LÝ (${s}s)...]</b>\n▶ <code>${escapeHtml(summary)}</code>`;
        finishedFn = (s) => `⚡ <b>[ĐÃ XỬ LÝ XONG]</b>\n▶ <code>${escapeHtml(summary)}</code>\n<i>↳ ✅ Hoàn tất trong ${s}s</i>`;
    }

    return { summary, runningFn, finishedFn };
}

module.exports = {
    formatToolCall
};
