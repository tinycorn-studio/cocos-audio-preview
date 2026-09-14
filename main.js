'use strict';

const { BrowserWindow } = require('electron');

let isAutoPlayEnabled = true;
let isLoopEnabled = false;
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
            const loopVal = await Editor.Profile.getConfig('auto-play-audio', 'loop');
            if (typeof loopVal === 'boolean') {
                isLoopEnabled = loopVal;
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
            await Editor.Profile.setConfig('auto-play-audio', 'loop', isLoopEnabled);
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
    // Khởi tạo trang HTML với Web Audio API context sẵn sàng
    const initHtml = `data:text/html;charset=utf-8,<html><body><script>
        window._ctx = new (window.AudioContext || window.webkitAudioContext)();
        window._source = null;
        window._gain = null;
    </script></body></html>`;
    playerWin.loadURL(initHtml);
    return playerWin;
}

/**
 * Phát file âm thanh qua background BrowserWindow sử dụng Web Audio API
 * Dùng AudioContext + GainNode để fade-out mượt mà khi chuyển bài, tránh tiếng rè/click
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
            (async function() {
                try {
                    // Fade-out bài cũ mượt mà (30ms) trước khi dừng
                    if (window._gain && window._source) {
                        try {
                            var t = window._ctx.currentTime;
                            window._gain.gain.setValueAtTime(window._gain.gain.value, t);
                            window._gain.gain.linearRampToValueAtTime(0.0001, t + 0.03);
                            // Chờ fade-out xong
                            await new Promise(function(r) { setTimeout(r, 35); });
                            window._source.stop();
                        } catch(e) {}
                        window._source = null;
                        window._gain = null;
                    }

                    // Nếu AudioContext bị suspended (do Chromium policy), resume nó
                    if (window._ctx.state === 'suspended') {
                        await window._ctx.resume();
                    }

                    // Fetch file audio và decode thành AudioBuffer
                    var resp = await fetch(${JSON.stringify(fileUrl)});
                    var arrayBuf = await resp.arrayBuffer();
                    var audioBuf = await window._ctx.decodeAudioData(arrayBuf);

                    // Tạo source + gain node mới
                    var source = window._ctx.createBufferSource();
                    source.buffer = audioBuf;
                    source.loop = ${isLoopEnabled};
                    var gain = window._ctx.createGain();
                    gain.gain.value = 1.0;
                    source.connect(gain);
                    gain.connect(window._ctx.destination);

                    window._source = source;
                    window._gain = gain;

                    source.start(0);
                    source.onended = function() {
                        window._source = null;
                        window._gain = null;
                    };
                } catch (e) {
                    console.error('[Auto Play Audio] Lỗi phát audio:', e);
                    // Fallback: thử HTMLAudioElement nếu Web Audio API thất bại
                    try {
                        if (window._audioFallback) {
                            window._audioFallback.volume = 0;
                            window._audioFallback.pause();
                            window._audioFallback = null;
                        }
                        var a = new Audio(${JSON.stringify(fileUrl)});
                        window._audioFallback = a;
                        a.loop = ${isLoopEnabled};
                        a.volume = 1.0;
                        a.play().catch(function(){});
                    } catch(e2) {}
                }
            })();
        `;
        win.webContents.executeJavaScript(code).catch(() => {});
    } catch (err) {
        console.error('[Auto Play Audio] Không thể phát âm thanh:', err);
    }
}

/**
 * Dừng phát âm thanh trên background window (fade-out mượt mà)
 */
function stopBackground() {
    lastPlayedFile = null;
    if (!playerWin || playerWin.isDestroyed()) return;
    try {
        const code = `
            (async function() {
                // Fade-out Web Audio API
                if (window._gain && window._source) {
                    try {
                        var t = window._ctx.currentTime;
                        window._gain.gain.setValueAtTime(window._gain.gain.value, t);
                        window._gain.gain.linearRampToValueAtTime(0.0001, t + 0.03);
                        await new Promise(function(r) { setTimeout(r, 35); });
                        window._source.stop();
                    } catch(e) {}
                    window._source = null;
                    window._gain = null;
                }
                // Fallback cleanup
                if (window._audioFallback) {
                    window._audioFallback.volume = 0;
                    window._audioFallback.pause();
                    window._audioFallback = null;
                }
            })();
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

        getLoop() {
            return isLoopEnabled;
        },

        async setLoop(val) {
            isLoopEnabled = !!val;
            await saveProfile();
            if (playerWin && !playerWin.isDestroyed()) {
                const code = `
                    if (window._source) window._source.loop = ${isLoopEnabled};
                    if (window._audioFallback) window._audioFallback.loop = ${isLoopEnabled};
                `;
                playerWin.webContents.executeJavaScript(code).catch(() => {});
            }
            if (typeof Editor !== 'undefined' && Editor.Message) {
                Editor.Message.broadcast('auto-play-audio:loop-changed', isLoopEnabled);
            }
            console.log(`[Auto Play Audio] Loop: ${isLoopEnabled ? 'BẬT' : 'TẮT'}`);
            return isLoopEnabled;
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
