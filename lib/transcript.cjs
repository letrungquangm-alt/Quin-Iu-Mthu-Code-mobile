const fs = require('fs');

function createTranscriptWatcher({ transcriptPath, onToolCall, onToolComplete, onPlannerResponse }) {
    let lastOffset = 0;
    let isWatching = true;

    if (fs.existsSync(transcriptPath)) {
        try {
            lastOffset = fs.statSync(transcriptPath).size;
            console.log(`[Transcript Watcher] Khởi tạo offset ban đầu: ${lastOffset} bytes`);
        } catch (e) {}
    }

    function fastForward() {
        if (fs.existsSync(transcriptPath)) {
            try {
                lastOffset = fs.statSync(transcriptPath).size;
                console.log(`[Transcript Watcher] Đã tua nhanh offset: ${lastOffset} bytes`);
            } catch (e) {}
        }
    }

    async function tick() {
        if (!isWatching || !fs.existsSync(transcriptPath)) return;
        let stat;
        try {
            stat = fs.statSync(transcriptPath);
        } catch (e) {
            return;
        }

        if (stat.size <= lastOffset) return;

        let buf;
        try {
            const fd = fs.openSync(transcriptPath, 'r');
            const bufLen = stat.size - lastOffset;
            buf = Buffer.alloc(bufLen);
            fs.readSync(fd, buf, 0, bufLen, lastOffset);
            fs.closeSync(fd);
            lastOffset = stat.size;
        } catch (e) {
            return;
        }

        const content = buf.toString('utf8');
        const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);

        for (const line of lines) {
            try {
                const entry = JSON.parse(line);

                // 1. Tool Call
                if (entry.tool_calls && entry.tool_calls.length > 0) {
                    if (onToolCall) onToolCall(entry.tool_calls);
                }

                // 2. Tool Completion
                if (entry.type === 'GENERIC' && entry.content) {
                    if (onToolComplete) onToolComplete(entry);
                }

                // 3. Final Planner Response
                if (entry.type === 'PLANNER_RESPONSE' && entry.content && (!entry.tool_calls || entry.tool_calls.length === 0)) {
                    const text = entry.content.toString().trim();
                    if (text && onPlannerResponse) {
                        onPlannerResponse(text);
                    }
                }
            } catch (e) {}
        }
    }

    const timer = setInterval(tick, 100);

    return {
        fastForward,
        stop: () => {
            isWatching = false;
            clearInterval(timer);
        },
        getOffset: () => lastOffset
    };
}

module.exports = {
    createTranscriptWatcher
};
