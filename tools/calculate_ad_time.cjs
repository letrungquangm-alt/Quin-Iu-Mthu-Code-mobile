const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\letru\\OneDrive\\Máy tính\\KKPhim_Conan_Qua_Bom_Choc_Troi\\original_playlist.m3u8', 'utf8');
const lines = content.split(/\r?\n/);

let currentTimeInMovie = 0;
let currentTimeInOriginalStream = 0;
let inAdBlock = false;
let adBlocks = [];
let currentAd = null;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXTINF:')) {
        const dur = parseFloat(line.replace('#EXTINF:', '').replace(',', '')) || 0;
        const url = (lines[i + 1] || '').trim();
        const isAd = url.includes('convertv8') || url.includes('/v8/') || url.includes('segment_');

        if (isAd) {
            if (!inAdBlock) {
                inAdBlock = true;
                currentAd = {
                    movieTimeStart: currentTimeInMovie,
                    originalStreamStart: currentTimeInOriginalStream,
                    segments: [],
                    totalDur: 0
                };
            }
            currentAd.segments.push({ dur, url });
            currentAd.totalDur += dur;
        } else {
            if (inAdBlock) {
                inAdBlock = false;
                adBlocks.push(currentAd);
                currentAd = null;
            }
            currentTimeInMovie += dur;
        }
        currentTimeInOriginalStream += dur;
        i++;
    }
}
if (inAdBlock && currentAd) {
    adBlocks.push(currentAd);
}

function fmt(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const ms = Math.floor((totalSeconds % 1) * 10);
    const pad = (n) => String(n).padStart(2, '0');
    if (hours > 0) {
        return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${ms} (${minutes} phút ${seconds} giây)`;
    }
    return `${pad(minutes)}:${pad(seconds)}.${ms} (${minutes} phút ${seconds} giây)`;
}

console.log('Tổng số đợt quảng cáo được chèn:', adBlocks.length);
adBlocks.forEach((b, idx) => {
    console.log(`\n======================================================`);
    console.log(`📌 ĐỢT QUẢNG CÁO SỐ ${idx + 1}:`);
    console.log(`• Thời điểm xuất hiện trên luồng gốc : ${fmt(b.originalStreamStart)}`);
    console.log(`• Thời điểm tương ứng trong phim    : ${fmt(b.movieTimeStart)}`);
    console.log(`• Độ dài đoạn quảng cáo             : ${b.totalDur.toFixed(2)} giây`);
    console.log(`• Kết thúc quảng cáo quay lại phim  : ${fmt(b.originalStreamStart + b.totalDur)}`);
    console.log(`• Số lượng segment (.ts)            : ${b.segments.length} segments`);
    console.log(`• Mẫu URL đoạn quảng cáo            : ${b.segments[0].url}`);
    if (b.segments.length > 1) {
        console.log(`• Segment cuối                      : ${b.segments[b.segments.length - 1].url}`);
    }
});
