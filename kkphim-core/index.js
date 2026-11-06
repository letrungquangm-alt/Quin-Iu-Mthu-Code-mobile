const KKPHIM_BASE = 'https://phimapi.com';

class KKPhimSDK {
    constructor(baseUrl = KKPHIM_BASE) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
    }

    async request(path, params = {}) {
        const url = new URL(this.baseUrl + (path.startsWith('/') ? path : '/' + path));
        Object.entries(params).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== '') {
                url.searchParams.append(k, String(v));
            }
        });

        const res = await fetch(url.toString(), {
            headers: { accept: 'application/json' }
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        return await res.json();
    }

    // --- 1. PHIM MỚI & TRANG CHỦ ---
    getLatestLegacy(page = 1) {
        return this.request('/danh-sach/phim-moi-cap-nhat', { page });
    }

    getHome() {
        return this.request('/v1/api/home');
    }

    getLatestV1(page = 1) {
        return this.request('/v1/api/danh-sach/phim-moi', { page });
    }

    getListV1(params = {}) {
        return this.request('/v1/api/danh-sach', params);
    }

    // --- 2. DANH SÁCH THEO LOẠI ---
    getListByTypeLegacy(type = 'phim-bo', page = 1) {
        return this.request(`/danh-sach/${type}`, { page });
    }

    getListByTypeV1(type = 'phim-le', params = {}) {
        return this.request(`/v1/api/danh-sach/${type}`, params);
    }

    // --- 3. CHI TIẾT PHIM ---
    getMovieLegacy(slug) {
        return this.request(`/phim/${slug}`);
    }

    getMovieById(id) {
        return this.request(`/phim/id/${id}`);
    }

    getMovieByTmdb(tmdbId, type = 'movie') {
        return this.request(`/tmdb/${type}/${tmdbId}`);
    }

    getMovieByImdb(imdbId) {
        return this.request(`/imdb/title/${imdbId}`);
    }

    getMovieV1(slug) {
        return this.request(`/v1/api/phim/${slug}`);
    }

    getMovieImages(slug) {
        return this.request(`/v1/api/phim/${slug}/images`);
    }

    getMoviePeoples(slug) {
        return this.request(`/v1/api/phim/${slug}/peoples`);
    }

    getMovieKeywords(slug) {
        return this.request(`/v1/api/phim/${slug}/keywords`);
    }

    // --- 4. THỂ LOẠI ---
    getCategories() {
        return this.request('/the-loai');
    }

    getCategoryMovies(slug, params = {}) {
        return this.request(`/v1/api/the-loai/${slug}`, params);
    }

    // --- 5. QUỐC GIA ---
    getCountries() {
        return this.request('/quoc-gia');
    }

    getCountryMovies(slug, params = {}) {
        return this.request(`/v1/api/quoc-gia/${slug}`, params);
    }

    // --- 6. NĂM PHÁT HÀNH ---
    getYears() {
        return this.request('/nam-phat-hanh');
    }

    getYearMovies(year, params = {}) {
        return this.request(`/v1/api/nam/${year}`, params);
    }

    // --- 7. TÌM KIẾM ---
    search(keyword, params = {}) {
        return this.request('/v1/api/tim-kiem', { keyword, ...params });
    }

    // Helper CDN ảnh
    getImageUrl(path) {
        if (!path) return '';
        if (path.startsWith('http://') || path.startsWith('https://')) return path;
        return `https://phimimg.com/${path.replace(/^\/+/, '')}`;
    }
}

module.exports = KKPhimSDK;
