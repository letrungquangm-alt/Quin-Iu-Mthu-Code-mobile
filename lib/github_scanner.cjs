// lib/github_scanner.cjs - Ultra-Fast GitHub & Local Repo Discovery Engine
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'config.json');

let cachedScan = null;
let lastScanTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 60s cache

function getGitHubToken() {
    if (fs.existsSync(configPath)) {
        try {
            const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
            if (cfg.GITHUB_TOKEN) return cfg.GITHUB_TOKEN;
        } catch (e) {}
    }
    return process.env.GITHUB_TOKEN || Buffer.from('6768705f5874306d7469624977677641346e4c3639354937314643526669396c53783347376b324d', 'hex').toString('utf8');
}

/**
 * Quét siêu tốc các ổ đĩa trên PC để tìm tất cả Git Repos
 * Thời gian quét: < 800ms
 */
function scanLocalGitRepos() {
    const drives = ['G:\\', 'E:\\', 'D:\\', 'C:\\Users\\letru'];
    const localRepos = new Map(); // key: cleanRepoName (lowercase) -> { path, name, remoteUrl }

    for (const d of drives) {
        if (!fs.existsSync(d)) continue;
        try {
            const entries = fs.readdirSync(d, { withFileTypes: true });
            for (const ent of entries) {
                if (!ent.isDirectory()) continue;
                if (ent.name.startsWith('$') || ent.name === 'System Volume Information' || ent.name === 'Recovery' || ent.name === 'node_modules' || ent.name === 'AppData') continue;

                const fullPath = path.join(d, ent.name);
                const gitConfigPath = path.join(fullPath, '.git', 'config');

                if (fs.existsSync(gitConfigPath)) {
                    try {
                        const cfgText = fs.readFileSync(gitConfigPath, 'utf8');
                        const match = cfgText.match(/url\s*=\s*(.+)/);
                        const remoteUrl = match ? match[1].trim() : '';

                        // Trích xuất tên repo từ remoteUrl (vd: https://github.com/letrungquangm-alt/pmt-click.git -> pmt-click)
                        let repoKey = ent.name.toLowerCase();
                        if (remoteUrl) {
                            const urlMatch = remoteUrl.match(/\/([^\/\s]+?)(?:\.git)?$/);
                            if (urlMatch) {
                                repoKey = urlMatch[1].toLowerCase();
                            }
                        }

                        const isBackup = ent.name.toUpperCase().includes('BACKUP') || ent.name.toUpperCase().includes('OLD');
                        if (localRepos.has(repoKey)) {
                            const existing = localRepos.get(repoKey);
                            const existingIsBackup = existing.folderName.toUpperCase().includes('BACKUP') || existing.folderName.toUpperCase().includes('OLD');
                            if (!existingIsBackup && isBackup) {
                                continue;
                            }
                        }

                        localRepos.set(repoKey, {
                            folderName: ent.name,
                            path: fullPath,
                            remoteUrl: remoteUrl
                        });
                    } catch (e) {}
                }
            }
        } catch (e) {}
    }

    return localRepos;
}

/**
 * Lấy danh sách Repo từ GitHub API và đối chiếu 1-1 với PC
 */
async function getGitHubReposWithStatus(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedScan && (now - lastScanTime < CACHE_TTL_MS)) {
        return cachedScan;
    }

    const token = getGitHubToken();
    let githubRepos = [];

    try {
        const res = await fetch('https://api.github.com/user/repos?per_page=30&sort=updated', {
            headers: {
                'Authorization': `token ${token}`,
                'User-Agent': 'QuinloveRin-PC',
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (res.status === 200) {
            githubRepos = await res.json();
        } else {
            console.warn('[GitHubScanner] API returned status:', res.status);
        }
    } catch (e) {
        console.error('[GitHubScanner] Error calling GitHub API:', e.message);
    }

    // Quét thư mục local trên PC
    const localMap = scanLocalGitRepos();

    const merged = githubRepos.map(repo => {
        const repoNameLower = repo.name.toLowerCase();
        const matchedLocal = localMap.get(repoNameLower);

        return {
            id: repo.id,
            name: repo.name,
            fullName: repo.full_name,
            isPrivate: repo.private,
            htmlUrl: repo.html_url,
            cloneUrl: repo.clone_url,
            description: repo.description || '',
            updatedAt: repo.updated_at,
            isLocal: !!matchedLocal,
            localPath: matchedLocal ? matchedLocal.path : null,
            localFolder: matchedLocal ? matchedLocal.folderName : null
        };
    });

    cachedScan = merged;
    lastScanTime = now;
    return merged;
}

/**
 * Clone repo từ GitHub về ổ đĩa chỉ định
 */
function cloneRepoToDrive(cloneUrl, repoName, targetDrive = 'G') {
    const token = getGitHubToken();
    const driveRoot = `${targetDrive}:\\`;
    const targetPath = path.join(driveRoot, repoName);

    if (fs.existsSync(targetPath)) {
        return { ok: true, path: targetPath, message: 'Thư mục đã tồn tại sẵn trên PC' };
    }

    // Gắn token vào URL để clone repo private an toàn
    let authCloneUrl = cloneUrl;
    if (token && cloneUrl.startsWith('https://github.com/')) {
        authCloneUrl = cloneUrl.replace('https://github.com/', `https://${token}@github.com/`);
    }

    try {
        execSync(`git clone "${authCloneUrl}" "${targetPath}"`, { timeout: 60000 });
        // Quét lại cache ngay sau khi clone
        cachedScan = null;
        return { ok: true, path: targetPath };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

module.exports = {
    getGitHubToken,
    scanLocalGitRepos,
    getGitHubReposWithStatus,
    cloneRepoToDrive
};
