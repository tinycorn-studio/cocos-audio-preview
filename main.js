'use strict';

const { BrowserWindow } = require('electron');

let playerWin = null;
let isAutoPlayEnabled = true;
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
 * Khởi tạo hoặc lấy BrowserWindow ẩn chạy Chromium audio engine
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
 * Phát file âm thanh qua Chromium Web Audio
 * @param {string} filePath Đường dẫn tuyệt đối của file âm thanh
 */
function playAudio(filePath) {
    if (!filePath) return;

    const now = Date.now();
    // Debounce nếu cùng 1 file được gọi liên tục trong 150ms
    if (lastPlayedFile === filePath && (now - lastPlayTime < 150)) {
        return;
    }
    lastPlayedFile = filePath;
    lastPlayTime = now;

    try {
        const win = getPlayerWindow();
        const fileUrl = 'file:///' + filePath.replace(/\\/g, '/');
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
 * Dừng phát âm thanh hiện tại
 */
function stopAudio() {
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

/**
 * Kiểm tra xem đường dẫn file có phải là file âm thanh hay không
 * @param {string} filePath 
 */
function isAudioFile(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    const lower = filePath.toLowerCase();
    return lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.ogg') ||
           lower.endsWith('.m4a') || lower.endsWith('.aac') || lower.endsWith('.flac');
}

/**
 * Xử lý khi người dùng chọn/click vào một phần tử trong Editor
 */
async function handleSelection(type, current, all) {
    if (!isAutoPlayEnabled) return;

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
        // Khi chọn node trong Scene/Hierarchy thì dừng âm thanh preview
        stopAudio();
        return;
    }

    // Nếu type không được truyền, kiểm tra qua Editor.Selection
    if (!assetUuid && typeof Editor !== 'undefined' && Editor.Selection) {
        const selected = Editor.Selection.getSelected('asset');
        if (selected && selected.length > 0) {
            assetUuid = selected[0];
        }
    }

    if (assetUuid) {
        try {
            const assetInfo = await Editor.Message.request('asset-db', 'query-asset-info', assetUuid);
            if (assetInfo && (assetInfo.importer === 'audio-clip' || isAudioFile(assetInfo.file || assetInfo.source))) {
                console.log(`[Auto Play Audio] 🎵 Auto-playing: ${assetInfo.name || assetUuid}`);
                playAudio(assetInfo.file);
                return;
            }
        } catch (e) {}
    }

    // Nếu click vào asset không phải audio (ảnh, script, prefab...) thì dừng phát
    stopAudio();
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
        stopAudio();
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
                stopAudio();
            }
        },

        getAutoPlay() {
            return isAutoPlayEnabled;
        },

        async setAutoPlay(val) {
            isAutoPlayEnabled = !!val;
            await saveProfile();
            if (!isAutoPlayEnabled) {
                stopAudio();
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
            stopAudio();
            console.log('[Auto Play Audio] Đã dừng âm thanh.');
        }
    }
};
