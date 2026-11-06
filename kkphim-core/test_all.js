const KKPhimSDK = require('./index.js');

async function testAll() {
    const kk = new KKPhimSDK();
    console.log('=== TEST TOÀN BỘ ENDPOINT KKPHIM API ===\n');

    const tests = [
        { name: '1. Phim mới cập nhật (cũ)', fn: () => kk.getLatestLegacy(1) },
        { name: '2. Trang chủ (v1 home)', fn: () => kk.getHome() },
        { name: '3. Danh sách chung (v1 list)', fn: () => kk.getListV1({ page: 1 }) },
        { name: '4. Danh sách phim bộ (cũ)', fn: () => kk.getListByTypeLegacy('phim-bo', 1) },
        { name: '5. Danh sách phim lẻ có lọc (v1)', fn: () => kk.getListByTypeV1('phim-le', { country: 'han-quoc', year: 2024, limit: 5 }) },
        { name: '6. Chi tiết phim (cũ)', fn: () => kk.getMovieLegacy('sieu-nhan-tiga') },
        { name: '7. Chi tiết phim theo ID', fn: () => kk.getMovieById('054b7ae9cf9bbcc2be5a880618aa1fa2') },
        { name: '8. Chi tiết phim theo TMDB', fn: () => kk.getMovieByTmdb('2253', 'tv') },
        { name: '9. Chi tiết phim theo IMDB', fn: () => kk.getMovieByImdb('tt0182647') },
        { name: '10. Chi tiết phim (v1)', fn: () => kk.getMovieV1('sieu-nhan-tiga') },
        { name: '11. Hình ảnh phim (v1)', fn: () => kk.getMovieImages('sieu-nhan-tiga') },
        { name: '12. Diễn viên/Ekip (v1 peoples)', fn: () => kk.getMoviePeoples('sieu-nhan-tiga') },
        { name: '13. Từ khóa (v1 keywords)', fn: () => kk.getMovieKeywords('sieu-nhan-tiga') },
        { name: '14. Danh sách thể loại', fn: () => kk.getCategories() },
        { name: '15. Phim theo thể loại (hành động)', fn: () => kk.getCategoryMovies('hanh-dong', { page: 1, limit: 5 }) },
        { name: '16. Danh sách quốc gia', fn: () => kk.getCountries() },
        { name: '17. Phim theo quốc gia (hàn quốc)', fn: () => kk.getCountryMovies('han-quoc', { year: 2024, limit: 5 }) },
        { name: '18. Danh sách năm phát hành', fn: () => kk.getYears() },
        { name: '19. Phim theo năm (2024)', fn: () => kk.getYearMovies('2024', { category: 'hoat-hinh', limit: 5 }) },
        { name: '20. Tìm kiếm phim (avengers)', fn: () => kk.search('avengers', { limit: 5 }) }
    ];

    let passed = 0;
    for (const t of tests) {
        try {
            const start = Date.now();
            const res = await t.fn();
            const elapsed = Date.now() - start;
            const hasData = res && (res.status === true || res.status === 'success' || Array.isArray(res) || res.movie || res.data || res.items);
            if (hasData) {
                console.log(`✅ [OK] ${t.name} (${elapsed}ms)`);
                passed++;
            } else {
                console.log(`⚠️ [WARN] ${t.name}: Không có dữ liệu chuẩn`);
            }
        } catch (e) {
            console.log(`❌ [FAIL] ${t.name}: ${e.message}`);
        }
    }

    console.log(`\n=== KẾT QUẢ: ${passed}/${tests.length} ENDPOINTS HOẠT ĐỘNG HOÀN HẢO ===`);
}

testAll();
