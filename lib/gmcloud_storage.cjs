// lib/gmcloud_storage.cjs - GMCloud Storage Engine & Snapshot Packager
// Đóng gói cây mã nguồn PC thành Gzip bundle và đăng vĩnh cửu vào Topic # (General Topic - Kho GMCloud Storage)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    '.wrangler',
    '.agents',
    'screenshots',
    'recordings',
    'tmp',
    'temp',
    '.system_generated'
]);

const ALLOWED_EXTS = new Set([
    '.js',
    '.cjs',
    '.mjs',
    '.json',
    '.ps1',
    '.bat',
    '.cmd',
    '.toml',
    '.md',
    '.txt',
    '.yaml',
    '.yml',
    '.html',
    '.css'
]);

// Topic # (General Topic) trong Telegram Bot API được chỉ định bằng cách không truyền message_thread_id
const STORAGE_THREAD_ID = null;

/**
 * Đóng gói toàn bộ cây mã nguồn của dự án thành Bundle Gzip siêu nhẹ
 */
function createRepoBundle(rootDir = path.resolve(__dirname, '..')) {
    const bundle = {};
    const fileTree = [];
    let fileCount = 0;
    let rawBytes = 0;

    function walk(dir) {
        let entries = [];
        try {
            entries = fs.readdirSync(dir);
        } catch (e) {
            return;
        }

        for (const entry of entries) {
            if (IGNORED_DIRS.has(entry) || entry.startsWith('.')) continue;
            const fullPath = path.join(dir, entry);
            let st;
            try {
                st = fs.statSync(fullPath);
            } catch (e) {
                continue;
            }

            if (st.isDirectory()) {
                walk(fullPath);
            } else if (st.isFile()) {
                const ext = path.extname(entry).toLowerCase();
                if (ALLOWED_EXTS.has(ext) && !entry.endsWith('.signal') && !entry.endsWith('.pid') && !entry.includes('_bundle.gz') && !entry.includes('_snapshot_')) {
                    if (st.size > 1024 * 1024) continue;
                    const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
                    try {
                        const content = fs.readFileSync(fullPath, 'utf8');
                        bundle[relPath] = content;
                        fileTree.push({ path: relPath, size: st.size });
                        rawBytes += st.size;
                        fileCount++;
                    } catch (e) {}
                }
            }
        }
    }

    walk(rootDir);

    const jsonStr = JSON.stringify({
        repo: path.basename(rootDir),
        generated_at: new Date().toISOString(),
        file_count: fileCount,
        files: bundle
    });

    const gzipped = zlib.gzipSync(Buffer.from(jsonStr, 'utf8'));

    return {
        fileCount,
        rawBytes,
        gzippedSize: gzipped.length,
        fileTree,
        gzippedBuffer: gzipped
    };
}

/**
 * Tải Bundle Gzip lên Telegram qua multipart/form-data trực tiếp vào Topic # (General Topic)
 */
async function uploadBundleToTelegram(botToken, chatId, gzippedBuffer, meta = {}) {
    const boundary = '----GMCloudStorageBoundary' + Date.now().toString(16);
    const fileName = `gmcloud_repo_snapshot_${Date.now()}.gz`;

    const caption = `📦 <b>[GMCLOUD VIRTUAL REPO SNAPSHOT]</b>\n──────────────────────\n📂 <b>Dự án:</b> <code>${meta.repo || 'Quin-Iu-Mthu-Code-mobile'}</code>\n🏛️ <b>Kênh lưu trữ:</b> Topic # (<code>☁️ Kho GMCloud Storage</code> vĩnh cửu)\n📄 <b>Số lượng:</b> ${meta.fileCount || 0} files mã nguồn\n⚡ <b>Dung lượng nén:</b> ${(gzippedBuffer.length / 1024).toFixed(1)} KB (Gzip)\n🕒 <b>Đồng bộ lúc:</b> ${new Date().toLocaleTimeString('vi-VN')}\n\n☁️ <i>Đã lưu trữ an toàn trong Kho GMCloud (Topic #) để dữ liệu vĩnh viễn không bị mất khi đóng topic!</i>`;

    const parts = [];

    // chat_id
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`));

    // message_thread_id: Đối với General Topic #, KHÔNG truyền message_thread_id
    if (meta.threadId && Number(meta.threadId) > 1) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="message_thread_id"\r\n\r\n${meta.threadId}\r\n`));
    }

    // caption
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML\r\n`));

    // document file
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: application/gzip\r\n\r\n`));
    parts.push(gzippedBuffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const bodyBuffer = Buffer.concat(parts);

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
        method: 'POST',
        headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': bodyBuffer.length.toString()
        },
        body: bodyBuffer
    });

    const data = await res.json();
    if (!data.ok || !data.result) {
        throw new Error(data.description || 'Lỗi gửi file lên Telegram');
    }

    const doc = data.result.document;
    return {
        file_id: doc.file_id,
        file_unique_id: doc.file_unique_id,
        file_size: doc.file_size,
        message_id: data.result.message_id
    };
}

/**
 * Đồng bộ toàn bộ Repo PC lên GMCloud Storage (Topic #) và báo cho Cloudflare Worker 24/7
 */
async function syncRepoToGmCloud(botToken, chatId, workerUrlOrThreadId, rootDirOrWorkerUrl, possibleRootDir) {
    let workerUrl = workerUrlOrThreadId;
    let targetDir = rootDirOrWorkerUrl;
    if (typeof workerUrlOrThreadId === 'number' || (typeof workerUrlOrThreadId === 'string' && /^\d+$/.test(workerUrlOrThreadId))) {
        workerUrl = rootDirOrWorkerUrl;
        targetDir = possibleRootDir;
    }
    targetDir = targetDir || path.resolve(__dirname, '..');
    console.log('[GMCloud Storage] Đang quét và đóng gói cây mã nguồn...');
    const bundle = createRepoBundle(targetDir);
    console.log(`[GMCloud Storage] Đã đóng gói ${bundle.fileCount} files (${(bundle.rawBytes / 1024).toFixed(1)} KB) -> ${(bundle.gzippedSize / 1024).toFixed(1)} KB (Gzip)`);

    console.log('[GMCloud Storage] Đang tải lên Topic # (Kho GMCloud Storage vĩnh cửu)...');
    const uploadRes = await uploadBundleToTelegram(botToken, chatId, bundle.gzippedBuffer, {
        repo: path.basename(targetDir),
        fileCount: bundle.fileCount,
        threadId: null // Lưu vào Topic # (General)
    });

    console.log(`[GMCloud Storage] Đã lưu trữ thành công trên Topic #! File ID: ${uploadRes.file_id}`);

    // Bắn thông tin file_id sang Cloudflare Worker
    if (workerUrl) {
        try {
            console.log('[GMCloud Storage] Đang đồng bộ thông tin sang Cloudflare Worker...');
            await fetch(`${workerUrl}/gmcloud/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    thread_id: 1,
                    repo: path.basename(targetDir),
                    file_id: uploadRes.file_id,
                    file_count: bundle.fileCount,
                    raw_size: bundle.rawBytes,
                    gzipped_size: bundle.gzippedSize,
                    file_tree: bundle.fileTree.map(f => f.path)
                })
            });
        } catch (e) {
            console.warn('[GMCloud Worker Sync Fail]:', e.message);
        }
    }

    // Lưu manifest cục bộ trên PC
    const manifestPath = path.join(targetDir, 'gmcloud_manifest.json');
    const legacyPath = path.join(targetDir, 'telecloud_manifest.json');
    const manifestData = {
        updated_at: new Date().toISOString(),
        file_id: uploadRes.file_id,
        message_id: uploadRes.message_id,
        topic: "General (#)",
        file_count: bundle.fileCount,
        raw_bytes: bundle.rawBytes,
        gzipped_size: bundle.gzippedSize,
        file_tree: bundle.fileTree
    };

    try {
        fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), 'utf8');
        fs.writeFileSync(legacyPath, JSON.stringify(manifestData, null, 2), 'utf8');
    } catch (e) {}

    return {
        ok: true,
        fileId: uploadRes.file_id,
        messageId: uploadRes.message_id,
        topic: "General (#)",
        fileCount: bundle.fileCount,
        gzippedSize: bundle.gzippedSize
    };
}

module.exports = {
    createRepoBundle,
    uploadBundleToTelegram,
    syncRepoToGmCloud,
    syncRepoToTeleCloud: syncRepoToGmCloud,
    STORAGE_THREAD_ID
};
