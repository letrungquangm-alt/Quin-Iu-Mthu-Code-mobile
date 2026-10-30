const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BROWSER_PATHS = {
    chrome: [
        `${process.env.ProgramFiles || 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
        `D:\\Browsers\\Chrome\\chrome.exe`
    ],
    edge: [
        `${process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${process.env.ProgramFiles || 'C:\\Program Files'}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `D:\\Browsers\\Edge\\msedge.exe`
    ],
    brave: [
        `${process.env.ProgramFiles || 'C:\\Program Files'}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        `${process.env.LOCALAPPDATA || ''}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        `D:\\Browsers\\Brave\\brave.exe`
    ],
    firefox: [
        `${process.env.ProgramFiles || 'C:\\Program Files'}\\Mozilla Firefox\\firefox.exe`,
        `${process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'}\\Mozilla Firefox\\firefox.exe`,
        `D:\\Browsers\\Firefox\\firefox.exe`
    ]
};

const WINGET_IDS = {
    chrome: 'Google.Chrome',
    brave: 'Brave.Brave',
    firefox: 'Mozilla.Firefox',
    edge: 'Microsoft.Edge'
};

function checkInstalledBrowsers() {
    const status = {
        chrome: false,
        edge: false,
        brave: false,
        firefox: false,
        available: []
    };

    for (const [name, paths] of Object.entries(BROWSER_PATHS)) {
        for (const p of paths) {
            if (p && fs.existsSync(p)) {
                status[name] = true;
                status.available.push(name);
                break;
            }
        }
    }
    status.hasAny = status.available.length > 0;
    return status;
}

function getBrowserInstallMarkup(browser = 'chrome') {
    return {
        inline_keyboard: [
            [
                { text: `⚡ Cài vào D:\\Browsers (Khuyên dùng net)`, callback_data: `inst_br:${browser}:D` },
                { text: `💻 Cài mặc định (Ổ C:)`, callback_data: `inst_br:${browser}:C` }
            ],
            [
                { text: `❌ Hủy bỏ`, callback_data: `inst_cancel` }
            ]
        ]
    };
}

async function installBrowserAsync(browser = 'chrome', locationDrive = 'D') {
    const pkgId = WINGET_IDS[browser.toLowerCase()] || 'Google.Chrome';
    const locParam = (locationDrive && locationDrive.toUpperCase() === 'D') ? `--location "D:\\Browsers\\${browser}"` : '';

    const cmd = `winget install --id ${pkgId} -e ${locParam} --accept-source-agreements --accept-package-agreements --silent`;
    console.log('[Browser Installer] Đang thực thi:', cmd);

    return new Promise((resolve) => {
        exec(cmd, { timeout: 180000 }, (error, stdout, stderr) => {
            if (error) {
                console.error('[Browser Install Fail]:', error.message);
                resolve({ ok: false, error: error.message, output: stdout || stderr });
            } else {
                console.log('[Browser Install OK]:', stdout);
                resolve({ ok: true, output: stdout });
            }
        });
    });
}

module.exports = {
    checkInstalledBrowsers,
    getBrowserInstallMarkup,
    installBrowserAsync,
    BROWSER_PATHS
};
