function getPinDisplay(pin) {
    const slots = ['_', '_', '_', '_'];
    for (let i = 0; i < (pin || '').length && i < 4; i++) {
        slots[i] = pin[i];
    }
    return `[ ${slots.join('  ')} ]`;
}

function getKeypadMarkup() {
    return {
        inline_keyboard: [
            [
                { text: '1', callback_data: 'pin_num_1' },
                { text: '2', callback_data: 'pin_num_2' },
                { text: '3', callback_data: 'pin_num_3' }
            ],
            [
                { text: '4', callback_data: 'pin_num_4' },
                { text: '5', callback_data: 'pin_num_5' },
                { text: '6', callback_data: 'pin_num_6' }
            ],
            [
                { text: '7', callback_data: 'pin_num_7' },
                { text: '8', callback_data: 'pin_num_8' },
                { text: '9', callback_data: 'pin_num_9' }
            ],
            [
                { text: '❌ Hủy', callback_data: 'pin_action_cancel' },
                { text: '⌫ Xóa', callback_data: 'pin_action_backspace' },
                { text: '↵ Enter', callback_data: 'pin_action_enter' }
            ]
        ]
    };
}

module.exports = {
    getPinDisplay,
    getKeypadMarkup
};
