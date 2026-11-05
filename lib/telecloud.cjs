// lib/telecloud.cjs - Backward compatibility wrapper for GMCloud Storage
const gmcloud = require('./gmcloud_storage.cjs');

module.exports = {
    createRepoBundle: gmcloud.createRepoBundle,
    uploadBundleToTelegram: gmcloud.uploadBundleToTelegram,
    syncRepoToTeleCloud: gmcloud.syncRepoToGmCloud,
    syncRepoToGmCloud: gmcloud.syncRepoToGmCloud,
    loadTeleCloudSnapshot: gmcloud.loadGmCloudSnapshot,
    loadGmCloudSnapshot: gmcloud.loadGmCloudSnapshot
};
