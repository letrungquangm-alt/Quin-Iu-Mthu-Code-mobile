// lib/mtproto_auth.cjs - Telegram MTProto User Account Engine (my.telegram.org + OTP)
const fs = require('fs');
const path = require('path');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const rootDir = path.resolve(__dirname, '..');
const sessionFilePath = path.join(rootDir, 'mtproto_session.json');

// Default API ID & Hash (Telegram Android / Web development keys)
// Bro có thể ghi đè bằng khóa riêng từ my.telegram.org
const DEFAULT_API_ID = 2040;
const DEFAULT_API_HASH = 'b18441a1ff607e10a989891a5462e627';

let authState = {
    step: 'IDLE', // 'IDLE' | 'AWAITING_API_ID' | 'AWAITING_API_HASH' | 'AWAITING_PHONE' | 'AWAITING_OTP' | 'AWAITING_2FA'
    apiId: DEFAULT_API_ID,
    apiHash: DEFAULT_API_HASH,
    phoneNumber: '',
    phoneCodeHash: '',
    tempClient: null
};

function loadSession() {
    if (fs.existsSync(sessionFilePath)) {
        try {
            const raw = fs.readFileSync(sessionFilePath, 'utf8').replace(/^\uFEFF/, '');
            return JSON.parse(raw);
        } catch (e) {}
    }
    return null;
}

function saveSession(data) {
    try {
        fs.writeFileSync(sessionFilePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        return false;
    }
}

function isMtprotoAuthenticated() {
    const s = loadSession();
    return !!(s && s.sessionString);
}

function getMtprotoSessionInfo() {
    return loadSession();
}

function logoutMtproto() {
    if (fs.existsSync(sessionFilePath)) {
        try { fs.unlinkSync(sessionFilePath); } catch (e) {}
    }
    authState.step = 'IDLE';
    if (authState.tempClient) {
        try { authState.tempClient.disconnect(); } catch (e) {}
        authState.tempClient = null;
    }
    return true;
}

/**
 * Bắt đầu quy trình đăng nhập MTProto (Nhận OTP qua số điện thoại)
 */
async function startAuthFlow(phoneNumber, customApiId = null, customApiHash = null) {
    const apiId = Number(customApiId || DEFAULT_API_ID);
    const apiHash = String(customApiHash || DEFAULT_API_HASH).trim();
    const cleanPhone = String(phoneNumber || '').trim().replace(/\s+/g, '');

    if (!cleanPhone.startsWith('+')) {
        return { ok: false, error: 'Số điện thoại phải có mã quốc gia kèm dấu + (Ví dụ: +84912345678)' };
    }

    if (authState.tempClient) {
        try { await authState.tempClient.disconnect(); } catch (e) {}
    }

    const session = new StringSession('');
    const client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 5
    });

    try {
        await client.connect();
        const sendResult = await client.sendCode(
            { apiId, apiHash },
            cleanPhone
        );

        authState = {
            step: 'AWAITING_OTP',
            apiId: apiId,
            apiHash: apiHash,
            phoneNumber: cleanPhone,
            phoneCodeHash: sendResult.phoneCodeHash,
            tempClient: client
        };

        return {
            ok: true,
            step: 'AWAITING_OTP',
            phoneNumber: cleanPhone,
            phoneCodeHash: sendResult.phoneCodeHash
        };
    } catch (e) {
        try { await client.disconnect(); } catch (err) {}
        authState.step = 'IDLE';
        authState.tempClient = null;
        return { ok: false, error: e.message };
    }
}

/**
 * Xác thực mã OTP nhận được từ Telegram
 */
async function verifyOtpCode(otpCode) {
    if (authState.step !== 'AWAITING_OTP' || !authState.tempClient) {
        return { ok: false, error: 'Chưa có phiên gửi OTP nào đang chờ.' };
    }

    const client = authState.tempClient;
    const cleanCode = String(otpCode || '').trim().replace(/\D/g, '');

    try {
        await client.signInUser(
            { apiId: authState.apiId, apiHash: authState.apiHash },
            {
                phoneNumber: authState.phoneNumber,
                phoneCodeHash: authState.phoneCodeHash,
                phoneCode: cleanCode
            }
        );

        const me = await client.getMe();
        const sessionString = client.session.save();

        const sessionData = {
            apiId: authState.apiId,
            apiHash: authState.apiHash,
            sessionString: sessionString,
            userPhone: authState.phoneNumber,
            userId: me.id ? me.id.toString() : '',
            userName: `${me.firstName || ''} ${me.lastName || ''}`.trim(),
            username: me.username || '',
            isPremium: !!me.premium,
            authTime: new Date().toISOString()
        };

        saveSession(sessionData);

        await client.disconnect();
        authState.step = 'IDLE';
        authState.tempClient = null;

        return { ok: true, session: sessionData };
    } catch (e) {
        if (e.message && e.message.includes('SESSION_PASSWORD_NEEDED')) {
            authState.step = 'AWAITING_2FA';
            return { ok: true, step: 'AWAITING_2FA', message: 'Tài khoản có bật bảo mật 2 bước (2FA). Vui lòng nhập mật khẩu Cloud 2FA:' };
        }
        return { ok: false, error: e.message };
    }
}

/**
 * Xác thực mật khẩu 2FA (nếu tài khoản có bật)
 */
async function verify2FaPassword(password) {
    if (authState.step !== 'AWAITING_2FA' || !authState.tempClient) {
        return { ok: false, error: 'Chưa ở bước chờ mật khẩu 2FA.' };
    }

    const client = authState.tempClient;
    try {
        await client.signInWithPassword(
            { apiId: authState.apiId, apiHash: authState.apiHash },
            { password: String(password).trim() }
        );

        const me = await client.getMe();
        const sessionString = client.session.save();

        const sessionData = {
            apiId: authState.apiId,
            apiHash: authState.apiHash,
            sessionString: sessionString,
            userPhone: authState.phoneNumber,
            userId: me.id ? me.id.toString() : '',
            userName: `${me.firstName || ''} ${me.lastName || ''}`.trim(),
            username: me.username || '',
            isPremium: !!me.premium,
            authTime: new Date().toISOString()
        };

        saveSession(sessionData);

        await client.disconnect();
        authState.step = 'IDLE';
        authState.tempClient = null;

        return { ok: true, session: sessionData };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/**
 * Tải file lên Telegram thông qua MTProto (lên tới 2GB - 4GB)
 * Mặc định gửi vào 'me' (Saved Messages - Tin nhắn đã lưu)
 */
async function uploadFileViaMtproto(filePath, caption = '', targetEntity = 'me') {
    const s = loadSession();
    if (!s || !s.sessionString) {
        throw new Error('Chưa đăng nhập tài khoản chính chủ qua MTProto');
    }

    if (!fs.existsSync(filePath)) {
        throw new Error('File không tồn tại: ' + filePath);
    }

    const session = new StringSession(s.sessionString);
    const client = new TelegramClient(session, s.apiId, s.apiHash, {
        connectionRetries: 5
    });

    await client.connect();

    try {
        const result = await client.sendFile(targetEntity, {
            file: filePath,
            caption: caption,
            workers: 4
        });

        await client.disconnect();
        return {
            ok: true,
            id: result.id ? result.id.toString() : '',
            size: fs.statSync(filePath).size
        };
    } catch (e) {
        await client.disconnect();
        throw e;
    }
}

module.exports = {
    DEFAULT_API_ID,
    DEFAULT_API_HASH,
    getAuthState: () => authState,
    resetAuthState: () => {
        if (authState.tempClient) {
            try { authState.tempClient.disconnect(); } catch (e) {}
        }
        authState = {
            step: 'IDLE',
            apiId: DEFAULT_API_ID,
            apiHash: DEFAULT_API_HASH,
            phoneNumber: '',
            phoneCodeHash: '',
            tempClient: null
        };
    },
    isMtprotoAuthenticated,
    getMtprotoSessionInfo,
    logoutMtproto,
    startAuthFlow,
    verifyOtpCode,
    verify2FaPassword,
    uploadFileViaMtproto
};
