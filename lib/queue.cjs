const promptQueue = [];

function getQueueButtons(targetId) {
    const buttons = [
        [{ text: '⚡ Ưu tiên dùng prompt này (Send now)', callback_data: `q_now:${targetId}` }],
        [{ text: '✏️ Sửa prompt đang chờ đó', callback_data: `q_edit:${targetId}` }],
        [{ text: '🗑️ Xóa prompt này', callback_data: `q_del:${targetId}` }],
        [{ text: '➕ Gửi thêm vào hàng chờ', callback_data: 'q_add' }]
    ];

    if (promptQueue.length >= 2) {
        buttons.push([
            { text: `📝 Chỉnh prompt trong hàng chờ (${promptQueue.length} prompt)`, callback_data: 'q_list' }
        ]);
    }

    return { inline_keyboard: buttons };
}

function addPrompt(promptObj) {
    promptQueue.push(promptObj);
    return promptObj;
}

function removePrompt(id) {
    const idx = promptQueue.findIndex(p => p.id === id);
    if (idx !== -1) {
        return promptQueue.splice(idx, 1)[0];
    }
    return null;
}

function getPrompt(id) {
    return promptQueue.find(p => p.id === id) || null;
}

function getNextPrompt() {
    return promptQueue.shift() || null;
}

function updatePrompt(id, newText) {
    const p = promptQueue.find(p => p.id === id);
    if (p) {
        p.text = newText;
        p.preview = newText.length > 55 ? newText.substring(0, 55) + '...' : newText;
        return p;
    }
    return null;
}

function getQueueListMarkup() {
    const rows = [];
    promptQueue.forEach((p, idx) => {
        const title = `#${idx + 1}: ${p.preview}`;
        rows.push([
            { text: `⚡ Chạy ngay: ${title.substring(0, 28)}`, callback_data: `q_now:${p.id}` },
            { text: `🗑️ Xóa`, callback_data: `q_del:${p.id}` }
        ]);
    });
    rows.push([{ text: '➕ Gửi thêm prompt vào hàng chờ', callback_data: 'q_add' }]);
    return { inline_keyboard: rows };
}

module.exports = {
    promptQueue,
    getQueueButtons,
    addPrompt,
    removePrompt,
    getPrompt,
    getNextPrompt,
    updatePrompt,
    getQueueListMarkup
};
