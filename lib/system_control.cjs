const { exec } = require('child_process');
const os = require('os');

/**
 * Kiểm tra hệ điều hành
 */
function getPlatform() {
  return os.platform(); // 'win32', 'linux', 'darwin'
}

/**
 * Tắt một ứng dụng cụ thể
 * @param {string} appName - Tên tiến trình (ví dụ: 'chrome.exe', 'code')
 * @returns {Promise<string>}
 */
function killApp(appName) {
  return new Promise((resolve, reject) => {
    const platform = getPlatform();
    let command;

    if (platform === 'win32') {
      // Windows: taskkill /F /IM <appName>
      command = `taskkill /F /IM ${appName}`;
    } else {
      // Linux/Mac: pkill -f <appName>
      command = `pkill -f ${appName}`;
    }

    exec(command, (error, stdout, stderr) => {
      if (error) {
        // Lỗi có thể do app không tồn tại hoặc không có quyền
        const msg = `Lỗi khi tắt app "${appName}": ${error.message}`;
        console.error(msg);
        resolve(msg); // Resolve với thông báo lỗi để không crash bot
      } else {
        const msg = `Đã tắt thành công ứng dụng: ${appName}`;
        console.log(msg);
        resolve(msg);
      }
    });
  });
}

/**
 * Tắt trình duyệt (Chrome, Firefox, Edge...)
 * @param {string} browserType - 'chrome', 'firefox', 'edge'
 * @returns {Promise<string>}
 */
function killBrowser(browserType) {
  const browserMap = {
    'chrome': 'chrome.exe',
    'firefox': 'firefox.exe',
    'edge': 'msedge.exe'
  };

  const appName = browserMap[browserType] || browserType;
  return killApp(appName);
}

/**
 * Shutdown hệ thống
 * @returns {Promise<string>}
 */
function shutdownSystem() {
  return new Promise((resolve) => {
    const platform = getPlatform();
    let command;

    if (platform === 'win32') {
      command = 'shutdown /s /t 5'; // Tắt sau 5 giây
    } else {
      command = 'sudo shutdown now'; // Linux/Mac
    }

    exec(command, (error, stdout, stderr) => {
      if (error) {
        resolve(`Lỗi khi thực hiện shutdown: ${error.message}`);
      } else {
        resolve('Đã gửi lệnh tắt máy. Hệ thống sẽ tắt sau 5 giây.');
      }
    });
  });
}

module.exports = {
  killApp,
  killBrowser,
  shutdownSystem
};
