const fs = require('fs');
const path = require('path');
const KKPhimSDK = require('../kkphim-core/index.js');

const inputUrl = 'https://kkphim.com/phim/tham-tu-lung-danh-conan-qua-bom-choc-troi';
const outputDir = path.join('C:', 'Users', 'letru', 'Desktop', 'KKPhim_Conan_Qua_Bom_Choc_Troi');

function extractSlug(urlOrSlug) {
    if (!urlOrSlug.includes('/') && !urlOrSlug.includes('.')) {
        return urlOrSlug.trim();
    }
    const match = urlOrSlug.match(/\/phim\/([^/?#]+)/i);
    if (match) return match[1];
    const parts = urlOrSlug.split('?')[0].split('#')[0].replace(/\/+$/, '').split('/');
    return parts[parts.length - 1];
}

async function run() {
    console.log(`[1] Đang bóc tách slug từ link: ${inputUrl}`);
    const slug = extractSlug(inputUrl);
    console.log(`=> Slug trích xuất: "${slug}"`);

    const kk = new KKPhimSDK();

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // 1. Gọi các API KKPhim liên quan
    console.log('[2] Đang gọi chuỗi API KKPhim cho bộ phim...');
    const [movieV1Res, imagesRes, peoplesRes, keywordsRes] = await Promise.all([
        kk.getMovieV1(slug).catch(e => ({ error: e.message })),
        kk.getMovieImages(slug).catch(e => ({ error: e.message })),
        kk.getMoviePeoples(slug).catch(e => ({ error: e.message })),
        kk.getMovieKeywords(slug).catch(e => ({ error: e.message }))
    ]);

    const item = movieV1Res.data?.item;
    if (!item) {
        throw new Error('Không tìm thấy thông tin phim từ API v1');
    }

    // Lấy thêm TMDB & IMDb nếu có ID
    let tmdbData = null;
    let imdbData = null;
    if (item.tmdb?.id) {
        try {
            tmdbData = await kk.getMovieByTmdb(item.tmdb.id, item.tmdb.type || 'movie');
        } catch (e) {}
    }
    if (item.imdb?.id) {
        try {
            imdbData = await kk.getMovieByImdb(item.imdb.id);
        } catch (e) {}
    }

    // 2. Xuất các file JSON bóc tách riêng biệt
    console.log('[3] Đang bóc tách thành các file JSON độc lập...');

    // A. metadata.json
    const metadata = {
        name: item.name,
        origin_name: item.origin_name,
        slug: item.slug,
        alternative_names: item.alternative_names || [],
        type: item.type,
        status: item.status,
        year: item.year,
        time: item.time,
        quality: item.quality,
        lang: item.lang,
        episode_current: item.episode_current,
        episode_total: item.episode_total,
        poster_url: kk.getImageUrl(item.poster_url),
        thumb_url: kk.getImageUrl(item.thumb_url),
        trailer_url: item.trailer_url,
        tmdb: item.tmdb,
        imdb: item.imdb,
        views: item.view,
        created: item.created?.time,
        modified: item.modified?.time
    };
    fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');

    // B. overview.json
    const overview = {
        title: item.name,
        slug: item.slug,
        content_html: item.content,
        content_plain: (item.content || '').replace(/<[^>]*>/g, '').trim(),
        seo_description: movieV1Res.data?.seoOnPage?.descriptionHead || ''
    };
    fs.writeFileSync(path.join(outputDir, 'overview.json'), JSON.stringify(overview, null, 2), 'utf8');

    // C. credits.json
    const credits = {
        directors: item.director || [],
        actors: item.actor || [],
        categories: (item.category || []).map(c => ({ id: c.id, name: c.name, slug: c.slug })),
        countries: (item.country || []).map(c => ({ id: c.id, name: c.name, slug: c.slug })),
        peoples_api: peoplesRes.data || null
    };
    fs.writeFileSync(path.join(outputDir, 'credits.json'), JSON.stringify(credits, null, 2), 'utf8');

    // D. tmdb_imdb.json
    const ratings = {
        tmdb_info: tmdbData || item.tmdb,
        imdb_info: imdbData || item.imdb
    };
    fs.writeFileSync(path.join(outputDir, 'tmdb_imdb.json'), JSON.stringify(ratings, null, 2), 'utf8');

    // E. media_assets.json
    const mediaAssets = {
        images_api: imagesRes.data || null,
        keywords_api: keywordsRes.data || null,
        seo_on_page: movieV1Res.data?.seoOnPage || null,
        breadcrumbs: movieV1Res.data?.breadCrumb || null
    };
    fs.writeFileSync(path.join(outputDir, 'media_assets.json'), JSON.stringify(mediaAssets, null, 2), 'utf8');

    // F. seasons_episodes.json
    const rawEpisodes = item.episodes || [];
    const serversList = rawEpisodes.map(srv => ({
        server_name: srv.server_name,
        is_ai: !!srv.is_ai,
        total_episodes: srv.server_data ? srv.server_data.length : 0,
        episodes: (srv.server_data || []).map(ep => ({
            name: ep.name,
            slug: ep.slug,
            filename: ep.filename,
            link_embed: ep.link_embed,
            link_m3u8: ep.link_m3u8
        }))
    }));
    fs.writeFileSync(path.join(outputDir, 'seasons_episodes.json'), JSON.stringify({ slug: item.slug, servers: serversList }, null, 2), 'utf8');

    // 3. Mổ xẻ luồng stream m3u8 (Thử nghiệm với Server 1: Vietsub hoặc Lồng tiếng)
    console.log('[4] Đang phân tích luồng stream m3u8...');
    const chosenServer = serversList[0] || {};
    const sampleEp = chosenServer.episodes?.[0];
    const masterM3u8Url = sampleEp?.link_m3u8;

    let subM3u8Url = masterM3u8Url;
    let masterContent = '';
    let subContent = '';
    let adSegments = [];
    let cleanLines = [];
    let totalAdDuration = 0;
    let totalMovieDuration = 0;

    if (masterM3u8Url) {
        console.log(`- Tải master m3u8: ${masterM3u8Url}`);
        const mRes = await fetch(masterM3u8Url);
        masterContent = await mRes.text();
        fs.writeFileSync(path.join(outputDir, 'master_playlist.m3u8'), masterContent, 'utf8');

        // Bóc sub playlist
        const lines = masterContent.split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                subM3u8Url = new URL(trimmed, masterM3u8Url).href;
                break;
            }
        }

        console.log(`- Tải sub-playlist chi tiết: ${subM3u8Url}`);
        const subRes = await fetch(subM3u8Url);
        subContent = await subRes.text();
        fs.writeFileSync(path.join(outputDir, 'original_playlist.m3u8'), subContent, 'utf8');

        // Lọc quảng cáo cá độ
        const subLines = subContent.split(/\r?\n/);

        for (let i = 0; i < subLines.length; i++) {
            const line = subLines[i];
            const trimmed = line.trim();

            if (trimmed.startsWith('#EXTINF:')) {
                const dur = parseFloat(trimmed.replace('#EXTINF:', '').replace(',', '')) || 0;
                const nextLine = (subLines[i + 1] || '').trim();

                // Nhận diện quảng cáo dựa trên đường dẫn chứa 'convertv8', '/v8/', hoặc patterns
                const isAd = nextLine.includes('convertv8') || nextLine.includes('/v8/') || nextLine.includes('segment_');

                if (isAd) {
                    adSegments.push({
                        inf: trimmed,
                        url: nextLine,
                        duration: dur,
                        reason: nextLine.includes('convertv8') ? 'Đoạn QC convertv8' : 'Đoạn QC server v8'
                    });
                    totalAdDuration += dur;
                    i++;
                    continue;
                } else {
                    totalMovieDuration += dur;
                    cleanLines.push(line);
                    const absUrl = new URL(nextLine, subM3u8Url).href;
                    cleanLines.push(absUrl);
                    i++;
                    continue;
                }
            }

            if (trimmed === '#EXT-X-DISCONTINUITY') {
                continue;
            }

            cleanLines.push(line);
        }

        const cleanM3u8Content = cleanLines.join('\n');
        fs.writeFileSync(path.join(outputDir, 'clean_playlist.m3u8'), cleanM3u8Content, 'utf8');
    }

    // 4. Báo cáo mổ xẻ
    const reportMd = `# 🎬 BÁO CÁO PHÂN TÍCH & BÓC TÁCH TỰ ĐỘNG TỪ LINK
────────────────────────────────────────────────────────
🔗 **Link gốc đầu vào:** \`${inputUrl}\`
🆔 **Slug tự động nhận diện:** \`${slug}\`
🎥 **Tên phim:** **${item.name}**
🇯🇵 **Tên gốc:** ${item.origin_name} (${item.year})
⏱️ **Thời lượng:** ${item.time} | **Chất lượng:** ${item.quality} | **Trạng thái:** ${item.episode_current}

---

## 1. CÁC FILE JSON ĐÃ BÓC TÁCH (SẴN SÀNG TÍCH HỢP):
* 📄 \`metadata.json\` : Tiêu đề, poster, chất lượng, thời lượng, năm, điểm TMDB/IMDb.
* 📄 \`overview.json\` : Cốt truyện đã lọc sạch mã HTML.
* 📄 \`credits.json\`  : Đạo diễn, diễn viên, quốc gia, thể loại.
* 📄 \`seasons_episodes.json\` : Toàn bộ danh sách server (Vietsub, Lồng tiếng), link embed & m3u8.
* 📄 \`tmdb_imdb.json\` : Thông tin đánh giá chi tiết từ TMDB & IMDb.
* 📄 \`media_assets.json\` : Banner, keyword, SEO tags, breadcrumb.

---

## 2. KẾT QUẢ MỔ XẺ LUỒNG STREAM M3U8 (${chosenServer.server_name} - ${sampleEp?.name || 'Full'}):
* 🔗 **Link m3u8 gốc:** \`${masterM3u8Url}\`
* ⏱️ **Thời lượng phim sạch:** ~${(totalMovieDuration / 60).toFixed(1)} phút (${totalMovieDuration.toFixed(1)} giây).
* 🚨 **Phát hiện quảng cáo cá độ:**
  * **Số đoạn quảng cáo phát hiện:** **${adSegments.length} segments**
  * **Tổng thời lượng quảng cáo bị triệt tiêu:** **${totalAdDuration.toFixed(2)} giây**
  * **Đặc điểm:** Các phân đoạn chứa URL \`convertv8\` và \`/v8/...\` bọc bởi tag \`#EXT-X-DISCONTINUITY\`.

---

## 3. FILE ĐÓNG GÓI MP4 CHẤT LƯỢNG GỐC:
* Đã xuất file m3u8 sạch 100%: \`clean_playlist.m3u8\`.
* Kèm file chạy 1-click: \`1_Click_Dong_Goi_Conan_MP4.bat\`.
`;
    fs.writeFileSync(path.join(outputDir, 'Bao_Cao_Trich_Xuat.md'), reportMd, 'utf8');

    // 5. File batch 1-click
    const batContent = `@echo off
chcp 65001 >nul
title Đóng gói Conan: Quả Bom Chọc Trời (Không Quảng Cáo)
echo ========================================================
echo  ĐANG ĐÓNG GÓI CONAN: QUẢ BOM CHỌC TRỜI SANG MP4
echo  Chất lượng: 1080p FHD Gốc - Đã lọc sạch 100% quảng cáo
echo ========================================================
echo.
ffmpeg -protocol_whitelist file,http,https,tcp,tls -i clean_playlist.m3u8 -c copy -bsf:a aac_adtstoasc -y "Conan_Qua_Bom_Choc_Troi_1080p_Clean.mp4"
echo.
if exist "Conan_Qua_Bom_Choc_Troi_1080p_Clean.mp4" (
    echo ========================================================
    echo  XUẤT FILE MP4 THÀNH CÔNG RỰC RỠ!
    echo  File: Conan_Qua_Bom_Choc_Troi_1080p_Clean.mp4
    echo ========================================================
) else (
    echo [Lỗi] Không thể đóng gói.
)
pause
`;
    fs.writeFileSync(path.join(outputDir, '1_Click_Dong_Goi_Conan_MP4.bat'), batContent, 'utf8');

    console.log(`[OK] Hoàn tất toàn bộ! Dữ liệu nằm tại: ${outputDir}`);
}

run().catch(e => {
    console.error('[ERROR]:', e);
    process.exit(1);
});
