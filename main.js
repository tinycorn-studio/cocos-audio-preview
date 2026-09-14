'use strict';

const { BrowserWindow } = require('electron');

let isAutoPlayEnabled = true;
let playerWin = null;
let lastPlayedFile = null;
let lastPlayTime = 0;

/**
 * Nạp cấu hình đã lưu từ Editor.Profile
 */
async function loadProfile() {
    try {
        if (typeof Editor !== 'undefined' && Editor.Profile) {
            const val = await Editor.Profile.getConfig('auto-play-audio', 'autoPlay');
            if (typeof val === 'boolean') {
                isAutoPlayEnabled = val;
            }
        }
    } catch (e) {}
}

/**
 * Lưu cấu hình vào Editor.Profile
 */
async function saveProfile() {
    try {
        if (typeof Editor !== 'undefined' && Editor.Profile) {
            await Editor.Profile.setConfig('auto-play-audio', 'autoPlay', isAutoPlayEnabled);
        }
    } catch (e) {}
}

/**
 * Khởi tạo hoặc lấy BrowserWindow ẩn dùng để phát audio
 * BrowserWindow này có autoplayPolicy: 'no-user-gesture-required' để không bị trình duyệt chặn
 */
function getPlayerWindow() {
    if (playerWin && !playerWin.isDestroyed()) {
        return playerWin;
    }
    playerWin = new BrowserWindow({
        show: false,
        width: 100,
        height: 100,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false,
            autoplayPolicy: 'no-user-gesture-required'
        }
    });
    playerWin.loadURL('data:text/html;charset=utf-8,<html><body></body></html>');
    return playerWin;
}

/**
 * Phát file âm thanh qua background BrowserWindow
 * @param {string} filePath Đường dẫn tuyệt đối của file âm thanh
 */
function playBackground(filePath) {
    if (!filePath || !isAutoPlayEnabled) return;

    const now = Date.now();
    if (lastPlayedFile === filePath && (now - lastPlayTime < 100)) {
        return;
    }
    lastPlayedFile = filePath;
    lastPlayTime = now;

    try {
        const win = getPlayerWindow();
        const fileUrl = encodeURI('file:///' + filePath.replace(/\\/g, '/')).replace(/#/g, '%23');
        const code = `
            (function() {
                try {
                    if (window._audio) {
                        window._audio.pause();
                        window._audio.currentTime = 0;
                        window._audio = null;
                    }
                    const a = new Audio(${JSON.stringify(fileUrl)});
                    window._audio = a;
                    a.volume = 1.0;
                    a.play().catch(function(e) {
                        console.warn('[Auto Play Audio] Lỗi phát audio:', e);
                    });
                } catch (e) {
                    console.error('[Auto Play Audio] Lỗi khởi tạo audio:', e);
                }
            })();
        `;
        win.webContents.executeJavaScript(code).catch(() => {});
    } catch (err) {
        console.error('[Auto Play Audio] Không thể phát âm thanh:', err);
    }
}

/**
 * Dừng phát âm thanh trên background window
 */
function stopBackground() {
    lastPlayedFile = null;
    if (!playerWin || playerWin.isDestroyed()) return;
    try {
        const code = `
            if (window._audio) {
                window._audio.pause();
                window._audio.currentTime = 0;
                window._audio = null;
            }
        `;
        playerWin.webContents.executeJavaScript(code).catch(() => {});
    } catch (e) {}
}

let unselectTimer = null;

/**
 * Dừng toàn bộ âm thanh (cả background lẫn Inspector)
 */
function stopAudioAll() {
    if (unselectTimer) {
        clearTimeout(unselectTimer);
        unselectTimer = null;
    }
    stopBackground();
    if (typeof Editor !== 'undefined' && Editor.Message) {
        Editor.Message.broadcast('auto-play-audio:stop');
    }
}

/**
 * Kiểm tra xem đường dẫn file có phải là file âm thanh hay không
 */
function isAudioFile(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    const lower = filePath.toLowerCase();
    return lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.ogg') ||
           lower.endsWith('.m4a') || lower.endsWith('.aac') || lower.endsWith('.flac');
}

let lastHandledUuid = null;
let lastHandledTime = 0;

/**
 * Xử lý khi người dùng chọn/click vào một phần tử trong Editor
 */
async function handleSelection(type, current, all) {
    if (!isAutoPlayEnabled) return;

    // Hủy bỏ bất kỳ lệnh unselect nào đang chờ
    if (unselectTimer) {
        clearTimeout(unselectTimer);
        unselectTimer = null;
    }

    let assetUuid = null;
    if (type === 'asset') {
        if (typeof current === 'string') {
            assetUuid = current;
        } else if (Array.isArray(current) && current.length > 0) {
            assetUuid = current[0];
        } else if (Array.isArray(all) && all.length > 0) {
            assetUuid = all[0];
        }
    } else if (type === 'node') {
        stopAudioAll();
        return;
    }

    if (!assetUuid && typeof Editor !== 'undefined' && Editor.Selection) {
        const selected = Editor.Selection.getSelected('asset');
        if (selected && selected.length > 0) {
            assetUuid = selected[0];
        }
    }

    if (!assetUuid) {
        stopAudioAll();
        return;
    }

    // Debounce: tránh xử lý trùng khi cả selection:select lẫn selection:activated đều fire cho CÙNG 1 asset
    const now = Date.now();
    if (assetUuid === lastHandledUuid && (now - lastHandledTime) < 300) {
        return;
    }
    lastHandledUuid = assetUuid;
    lastHandledTime = now;

    try {
        const assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', assetUuid);
        if (assetInfo && (assetInfo.importer === 'audio-clip' || isAudioFile(assetInfo.file || assetInfo.source))) {
            const filePath = assetInfo.file || assetInfo.source;
            console.log(`[Auto Play Audio] 🎵 Auto-playing: ${assetInfo.name || assetUuid}`);
            playBackground(filePath);
            // Broadcast play-asset SAU một khoảng nhỏ để Inspector update() chạy xong trước
            // (Inspector cần thời gian để render thẻ <audio> mới vào DOM)
            setTimeout(() => {
                if (typeof Editor !== 'undefined' && Editor.Message) {
                    Editor.Message.broadcast('auto-play-audio:play-asset', filePath);
                }
            }, 60);
            return;
        }
    } catch (e) {}

    stopAudioAll();
}

module.exports = {
    async load() {
        console.log('[Auto Play Audio] Extension đã sẵn sàng hoạt động.');
        await loadProfile();
        try {
            getPlayerWindow();
        } catch (e) {}
    },

    unload() {
        stopAudioAll();
        if (playerWin && !playerWin.isDestroyed()) {
            playerWin.destroy();
            playerWin = null;
        }
        console.log('[Auto Play Audio] Extension đã được gỡ tải.');
    },

    methods: {
        async onSelectionSelect(type, current, all) {
            await handleSelection(type, current, all);
        },

        async onSelectionActivated(type, current) {
            await handleSelection(type, current, null);
        },

        onSelectionUnselect(type) {
            if (type === 'asset') {
                if (unselectTimer) {
                    clearTimeout(unselectTimer);
                }
                // Debounce 150ms: khi click chuyển từ asset A sang asset B,
                // Editor sẽ unselect A rồi select B. Chúng ta chỉ dừng audio khi
                // THỰC SỰ không còn asset nào được chọn (người dùng click ra ngoài).
                unselectTimer = setTimeout(() => {
                    unselectTimer = null;
                    if (typeof Editor !== 'undefined' && Editor.Selection) {
                        const selected = Editor.Selection.getSelected('asset');
                        if (!selected || selected.length === 0) {
                            stopAudioAll();
                        }
                    }
                }, 150);
            }
        },

        playBackgroundAudio(filePath) {
            if (!isAutoPlayEnabled) return;
            console.log('[Auto Play Audio] 🎵 Background audio playing:', filePath);
            playBackground(filePath);
            return true;
        },

        stopBackgroundAudio() {
            stopBackground();
            return true;
        },

        getAutoPlay() {
            return isAutoPlayEnabled;
        },

        async setAutoPlay(val) {
            isAutoPlayEnabled = !!val;
            await saveProfile();
            if (!isAutoPlayEnabled) {
                stopAudioAll();
            }
            if (typeof Editor !== 'undefined' && Editor.Message) {
                Editor.Message.broadcast('auto-play-audio:changed', isAutoPlayEnabled);
            }
            console.log(`[Auto Play Audio] Auto-Play: ${isAutoPlayEnabled ? 'BẬT' : 'TẮT'}`);
            return isAutoPlayEnabled;
        },

        async toggleAutoPlay() {
            const newVal = !isAutoPlayEnabled;
            await this.setAutoPlay(newVal);
            const status = isAutoPlayEnabled ? 'BẬT (Enabled)' : 'TẮT (Disabled)';
            if (typeof Editor !== 'undefined' && Editor.Dialog) {
                Editor.Dialog.info(`Auto-Play Audio: ${status}`);
            }
            return isAutoPlayEnabled;
        },

        stopAudio() {
            stopAudioAll();
            console.log('[Auto Play Audio] Đã dừng âm thanh.');
            return true;
        }
    }
};
