'use strict';

/**
 * Gửi log sang main process để ghi nhận vào project.log
 */
function sendLog(...args) {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    console.log('[Auto Play Section]', msg);
    try {
        if (typeof Editor !== 'undefined' && Editor.Message) {
            Editor.Message.send('auto-play-audio', 'log', msg);
        }
    } catch (e) {}
}

/**
 * Tìm phần tử <audio> của audio-clip.js trong Inspector panel
 * @param {object} panel Panel controller hiện tại
 * @returns {HTMLAudioElement|null}
 */
function getAudioElement(panel) {
    try {
        // Cách 1: Tìm qua sibling ui-panel trong cùng content-section
        const container = panel && panel.$ && panel.$.container;
        if (container) {
            const root = typeof container.getRootNode === 'function' ? container.getRootNode() : null;
            const host = root && root.host ? root.host : (panel.$this || null);
            const parent = host ? host.parentElement : null;
            if (parent) {
                const uiPanels = parent.querySelectorAll('ui-panel');
                for (let i = 0; i < uiPanels.length; i++) {
                    const p = uiPanels[i];
                    if (p === host) continue;

                    // Kiểm tra panelObject.$ của audio-clip.js
                    if (p.panelObject && p.panelObject.$ && p.panelObject.$.container) {
                        const a = p.panelObject.$.container.querySelector('audio');
                        if (a) return a;
                    }
                    // Kiểm tra ShadowRoot
                    if (p.shadowRoot) {
                        const a = p.shadowRoot.querySelector('audio');
                        if (a) return a;
                    }
                    // Kiểm tra light DOM
                    const a = p.querySelector('audio');
                    if (a) return a;
                }
            }
        }

        // Cách 2: Quét toàn bộ ui-panel trong document
        const allPanels = document.querySelectorAll('ui-panel');
        for (let i = 0; i < allPanels.length; i++) {
            const p = allPanels[i];
            const src = p.getAttribute('src') || '';
            if (src.includes('audio-clip-section')) continue;

            if (p.panelObject && p.panelObject.$ && p.panelObject.$.container) {
                const a = p.panelObject.$.container.querySelector('audio');
                if (a) return a;
            }
            if (p.shadowRoot) {
                const a = p.shadowRoot.querySelector('audio');
                if (a) return a;
            }
            const a = p.querySelector('audio');
            if (a) return a;
        }

        // Cách 3: Query trực tiếp cấp document
        return document.querySelector('section.asset-audio-clip audio') ||
               document.querySelector('audio.audio') ||
               document.querySelector('audio');
    } catch (e) {
        sendLog('Lỗi trong getAudioElement:', e);
        return null;
    }
}

/**
 * Phát âm thanh đồng bộ giữa Inspector progress bar và background player
 * @param {object} panel Controller section
 * @param {string} filePath Đường dẫn file âm thanh
 */
function playAudioWithSync(panel, filePath) {
    if (!panel._isAutoPlayEnabled) return;

    let attempts = 0;
    const maxAttempts = 10;

    const tryStart = () => {
        if (!panel._isAutoPlayEnabled) return;

        const audioEl = getAudioElement(panel);
        if (audioEl) {
            panel._currentAudioEl = audioEl;

            // Xóa listener cũ trên phần tử audio này
            if (audioEl._autoPlayCleanup) {
                audioEl._autoPlayCleanup();
            }

            let isUsingBackgroundSound = false;

            const onPlay = () => {
                // Nếu người dùng ấn nút Play trên native controls (phát có tiếng), dừng ngay background
                if (!audioEl.muted) {
                    Editor.Message.send('auto-play-audio', 'stop-background-audio');
                    isUsingBackgroundSound = false;
                }
            };

            const onEnded = () => {
                Editor.Message.send('auto-play-audio', 'stop-background-audio');
                isUsingBackgroundSound = false;
            };

            const onPause = () => {
                // Nếu bị pause (người dùng bấm Pause trên inspector), dừng luôn background
                if (isUsingBackgroundSound) {
                    Editor.Message.send('auto-play-audio', 'stop-background-audio');
                    isUsingBackgroundSound = false;
                }
            };

            const onVolumeChange = () => {
                // Nếu người dùng bật âm thanh trên native player
                if (!audioEl.muted && isUsingBackgroundSound) {
                    Editor.Message.send('auto-play-audio', 'stop-background-audio');
                    isUsingBackgroundSound = false;
                }
            };

            audioEl.addEventListener('play', onPlay);
            audioEl.addEventListener('ended', onEnded);
            audioEl.addEventListener('pause', onPause);
            audioEl.addEventListener('volumechange', onVolumeChange);

            audioEl._autoPlayCleanup = () => {
                audioEl.removeEventListener('play', onPlay);
                audioEl.removeEventListener('ended', onEnded);
                audioEl.removeEventListener('pause', onPause);
                audioEl.removeEventListener('volumechange', onVolumeChange);
            };

            // Thử phát unmuted trước
            audioEl.muted = false;
            audioEl.currentTime = 0;

            const playPromise = audioEl.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    sendLog('Inspector audioEl.play() phát thành công trực tiếp!');
                    // Dừng background player vì Inspector đã tự phát được
                    Editor.Message.send('auto-play-audio', 'stop-background-audio');
                }).catch((err) => {
                    sendLog('Inspector audioEl bị Autoplay Policy chặn, dùng muted sync + background player.');
                    // Chromium cho phép muted play 100% không cần user gesture:
                    // Bật muted -> thanh tiến trình trên preview inspector CHẠY THEO!
                    if (panel._isAutoPlayEnabled && panel._currentAudioEl === audioEl) {
                        audioEl.muted = true;
                        audioEl.currentTime = 0;
                        audioEl.play().catch(() => {});

                        // Phát tiếng qua background player đồng thời
                        if (filePath) {
                            isUsingBackgroundSound = true;
                            Editor.Message.send('auto-play-audio', 'play-background-audio', filePath);
                        }
                    }
                });
            }
            return;
        }

        attempts++;
        if (attempts < maxAttempts) {
            setTimeout(tryStart, 30);
        } else {
            // Nếu không tìm thấy phần tử audio trong DOM, vẫn phát qua background
            sendLog('Không tìm thấy audioEl trong DOM sau 10 lần thử, phát qua background player.');
            if (panel._isAutoPlayEnabled && filePath) {
                Editor.Message.send('auto-play-audio', 'play-background-audio', filePath);
            }
        }
    };

    setTimeout(tryStart, 30);
}

exports.template = /* html */`
<div class="audio-clip-autoplay-wrapper">
    <ui-prop class="autoplay-prop">
        <ui-label slot="label" value="Auto Play" tooltip="Tự động phát khi chọn file âm thanh (như trên Unity)"></ui-label>
        <div slot="content" class="autoplay-content">
            <ui-checkbox class="autoplay-checkbox" tooltip="Bật/Tắt tính năng tự động phát"></ui-checkbox>
            <ui-button class="replay-btn tiny transparent" tooltip="Phát lại từ đầu (Replay)">
                <ui-icon value="play"></ui-icon>
            </ui-button>
            <ui-button class="stop-btn tiny transparent" tooltip="Dừng âm thanh (Stop)">
                <ui-icon value="stop"></ui-icon>
            </ui-button>
        </div>
    </ui-prop>
</div>
`;

exports.style = /* css */`
.audio-clip-autoplay-wrapper {
    margin-top: -8px;
    margin-bottom: 8px;
    padding: 0 4px;
}
.audio-clip-autoplay-wrapper .autoplay-content {
    display: flex;
    align-items: center;
    gap: 8px;
}
.audio-clip-autoplay-wrapper ui-button {
    cursor: pointer;
}
`;

exports.$ = {
    container: '.audio-clip-autoplay-wrapper',
    checkbox: '.autoplay-checkbox',
    replayBtn: '.replay-btn',
    stopBtn: '.stop-btn'
};

exports.ready = function() {
    const panel = this;
    panel._isAutoPlayEnabled = true;
    panel._currentAudioEl = null;

    // Lắng nghe sự kiện đổi trạng thái từ main process hoặc menu
    panel.onAutoPlayChange = (enabled) => {
        panel._isAutoPlayEnabled = !!enabled;
        if (panel.$.checkbox) {
            panel.$.checkbox.value = panel._isAutoPlayEnabled;
        }
        if (!panel._isAutoPlayEnabled) {
            if (panel._currentAudioEl) {
                panel._currentAudioEl.pause();
            }
            Editor.Message.send('auto-play-audio', 'stop-background-audio');
        }
    };

    panel.onStopAudio = () => {
        if (panel._currentAudioEl) {
            panel._currentAudioEl.pause();
            panel._currentAudioEl.currentTime = 0;
        }
        Editor.Message.send('auto-play-audio', 'stop-background-audio');
    };

    if (typeof Editor !== 'undefined' && Editor.Message && Editor.Message.addBroadcastListener) {
        Editor.Message.addBroadcastListener('auto-play-audio:changed', panel.onAutoPlayChange);
        Editor.Message.addBroadcastListener('auto-play-audio:stop', panel.onStopAudio);
    }

    // Toggle checkbox
    const onToggle = async (event) => {
        const val = event.target ? event.target.value : panel.$.checkbox.value;
        panel._isAutoPlayEnabled = !!val;
        if (!panel._isAutoPlayEnabled) {
            if (panel._currentAudioEl) {
                panel._currentAudioEl.pause();
                panel._currentAudioEl.currentTime = 0;
            }
            Editor.Message.send('auto-play-audio', 'stop-background-audio');
        }
        try {
            await Editor.Message.request('auto-play-audio', 'set-auto-play', panel._isAutoPlayEnabled);
        } catch (e) {}
    };

    panel.$.checkbox.addEventListener('change', onToggle);
    panel.$.checkbox.addEventListener('confirm', onToggle);

    // Nút Replay
    panel.$.replayBtn.addEventListener('click', () => {
        const filePath = panel.currentAsset && panel.currentAsset.file;
        playAudioWithSync(panel, filePath);
    });

    // Nút Stop
    panel.$.stopBtn.addEventListener('click', () => {
        if (panel._currentAudioEl) {
            panel._currentAudioEl.pause();
            panel._currentAudioEl.currentTime = 0;
        }
        Editor.Message.send('auto-play-audio', 'stop-background-audio');
    });
};

exports.update = async function(assetList, metaList) {
    const panel = this;
    if (assetList && assetList.length > 0) {
        panel.currentAsset = assetList[0];
    }

    // Cập nhật trạng thái checkbox từ main config
    try {
        const enabled = await Editor.Message.request('auto-play-audio', 'get-auto-play');
        if (typeof enabled === 'boolean') {
            panel._isAutoPlayEnabled = enabled;
        }
        if (panel.$.checkbox) {
            panel.$.checkbox.value = panel._isAutoPlayEnabled;
        }
    } catch (e) {}

    // Dừng âm thanh cũ nếu có
    if (panel._currentAudioEl) {
        try {
            panel._currentAudioEl.pause();
            panel._currentAudioEl.currentTime = 0;
        } catch (e) {}
    }
    Editor.Message.send('auto-play-audio', 'stop-background-audio');

    // Kích hoạt auto play đồng bộ
    if (panel.currentAsset && panel.currentAsset.file) {
        playAudioWithSync(panel, panel.currentAsset.file);
    }
};

exports.close = function() {
    const panel = this;
    if (panel._currentAudioEl) {
        try {
            panel._currentAudioEl.pause();
            panel._currentAudioEl.currentTime = 0;
        } catch (e) {}
        panel._currentAudioEl = null;
    }
    Editor.Message.send('auto-play-audio', 'stop-background-audio');

    if (panel.onAutoPlayChange && typeof Editor !== 'undefined' && Editor.Message && Editor.Message.removeBroadcastListener) {
        Editor.Message.removeBroadcastListener('auto-play-audio:changed', panel.onAutoPlayChange);
        Editor.Message.removeBroadcastListener('auto-play-audio:stop', panel.onStopAudio);
    }
};
