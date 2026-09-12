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
    if (lastPlayedFile === filePath && (now - lastPlayTime < 200)) {
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

module.exports = {
    async load() {
        console.log('[Auto Play Audio] Extension đã sẵn sàng hoạt động.');
        await loadProfile();
        try {
            getPlayerWindow();
        } catch (e) {}
    },

    unload() {
        stopBackground();
        if (playerWin && !playerWin.isDestroyed()) {
            playerWin.destroy();
            playerWin = null;
        }
        if (typeof Editor !== 'undefined' && Editor.Message) {
            Editor.Message.broadcast('auto-play-audio:stop');
        }
        console.log('[Auto Play Audio] Extension đã được gỡ tải.');
    },

    methods: {
        log(msg) {
            console.log('[Auto Play Inspector]', msg);
        },

        playBackgroundAudio(filePath) {
            if (!isAutoPlayEnabled) return;
            console.log('[Auto Play Audio] 🎵 Background audio playing:', filePath);
            playBackground(filePath);
        },

        stopBackgroundAudio() {
            stopBackground();
        },

        onSelectionSelect(type, current, all) {
            // Khi chọn asset, nếu không phải asset audio thì dừng âm thanh
            if (type === 'node') {
                stopBackground();
                if (typeof Editor !== 'undefined' && Editor.Message) {
                    Editor.Message.broadcast('auto-play-audio:stop');
                }
            }
        },

        onSelectionUnselect(type) {
            if (type === 'asset') {
                stopBackground();
                if (typeof Editor !== 'undefined' && Editor.Message) {
                    Editor.Message.broadcast('auto-play-audio:stop');
                }
            }
        },

        getAutoPlay() {
            return isAutoPlayEnabled;
        },

        async setAutoPlay(val) {
            isAutoPlayEnabled = !!val;
            await saveProfile();
            if (!isAutoPlayEnabled) {
                stopBackground();
                if (typeof Editor !== 'undefined' && Editor.Message) {
                    Editor.Message.broadcast('auto-play-audio:stop');
                }
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
            stopBackground();
            if (typeof Editor !== 'undefined' && Editor.Message) {
                Editor.Message.broadcast('auto-play-audio:stop');
            }
            console.log('[Auto Play Audio] Đã dừng âm thanh.');
        }
    }
};
