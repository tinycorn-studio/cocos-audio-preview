'use strict';

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
        return null;
    }
}

/**
 * Đồng bộ hóa thanh tiến trình của Inspector preview khi phát âm thanh
 * @param {object} panel Controller section
 */
function syncInspectorPlayer(panel) {
    if (!panel._isAutoPlayEnabled) return;

    let attempts = 0;
    const maxAttempts = 12;

    const trySync = () => {
        if (!panel._isAutoPlayEnabled) return;

        const audioEl = getAudioElement(panel);
        if (audioEl) {
            panel._currentAudioEl = audioEl;

            // Xóa event listener cũ
            if (audioEl._autoPlayCleanup) {
                audioEl._autoPlayCleanup();
            }

            const onPlay = () => {
                // Nếu người dùng bấm play trên native controls có tiếng
                if (!audioEl.muted) {
                    try {
                        Editor.Message.request('auto-play-audio', 'stop-background-audio');
                    } catch (e) {}
                }
            };

            const onVolumeChange = () => {
                if (!audioEl.muted) {
                    try {
                        Editor.Message.request('auto-play-audio', 'stop-background-audio');
                    } catch (e) {}
                }
            };

            const onPause = () => {
                try {
                    Editor.Message.request('auto-play-audio', 'stop-background-audio');
                } catch (e) {}
            };

            const onEnded = () => {
                try {
                    Editor.Message.request('auto-play-audio', 'stop-background-audio');
                } catch (e) {}
            };

            audioEl.addEventListener('play', onPlay);
            audioEl.addEventListener('volumechange', onVolumeChange);
            audioEl.addEventListener('pause', onPause);
            audioEl.addEventListener('ended', onEnded);

            audioEl._autoPlayCleanup = () => {
                audioEl.removeEventListener('play', onPlay);
                audioEl.removeEventListener('volumechange', onVolumeChange);
                audioEl.removeEventListener('pause', onPause);
                audioEl.removeEventListener('ended', onEnded);
            };

            // Bật muted = true để Chromium cho phép phát ngay lập tức (không bị Autoplay Policy chặn)
            // Nhờ đó thanh tiến trình (progress bar) trên Inspector preview chạy mượt mà!
            if (panel._isAutoPlayEnabled) {
                audioEl.muted = true;
                audioEl.currentTime = 0;
                audioEl.play().catch(() => {});
            }
            return;
        }

        attempts++;
        if (attempts < maxAttempts) {
            setTimeout(trySync, 35);
        }
    };

    setTimeout(trySync, 35);
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
        if (!panel._isAutoPlayEnabled && panel._currentAudioEl) {
            panel._currentAudioEl.pause();
        }
    };

    panel.onStopAudio = () => {
        if (panel._currentAudioEl) {
            panel._currentAudioEl.pause();
            panel._currentAudioEl.currentTime = 0;
        }
    };

    panel.onPlayAsset = () => {
        syncInspectorPlayer(panel);
    };

    if (typeof Editor !== 'undefined' && Editor.Message && Editor.Message.addBroadcastListener) {
        Editor.Message.addBroadcastListener('auto-play-audio:changed', panel.onAutoPlayChange);
        Editor.Message.addBroadcastListener('auto-play-audio:stop', panel.onStopAudio);
        Editor.Message.addBroadcastListener('auto-play-audio:play-asset', panel.onPlayAsset);
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
            try {
                await Editor.Message.request('auto-play-audio', 'stop-background-audio');
            } catch (e) {}
        }
        try {
            await Editor.Message.request('auto-play-audio', 'set-auto-play', panel._isAutoPlayEnabled);
        } catch (e) {}
    };

    panel.$.checkbox.addEventListener('change', onToggle);
    panel.$.checkbox.addEventListener('confirm', onToggle);

    // Nút Replay
    panel.$.replayBtn.addEventListener('click', async () => {
        const audioEl = getAudioElement(panel);
        if (audioEl) {
            panel._currentAudioEl = audioEl;
            audioEl.muted = true;
            audioEl.currentTime = 0;
            audioEl.play().catch(() => {});
        }
        if (panel.currentAsset && panel.currentAsset.file) {
            try {
                await Editor.Message.request('auto-play-audio', 'play-background-audio', panel.currentAsset.file);
            } catch (e) {}
        }
    });

    // Nút Stop
    panel.$.stopBtn.addEventListener('click', async () => {
        if (panel._currentAudioEl) {
            panel._currentAudioEl.pause();
            panel._currentAudioEl.currentTime = 0;
        }
        try {
            await Editor.Message.request('auto-play-audio', 'stop-background-audio');
        } catch (e) {}
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

    // Dừng âm thanh cũ trên inspector nếu có
    if (panel._currentAudioEl) {
        try {
            panel._currentAudioEl.pause();
            panel._currentAudioEl.currentTime = 0;
        } catch (e) {}
    }

    // Kích hoạt đồng bộ hóa thanh tiến trình
    syncInspectorPlayer(panel);
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

    if (panel.onAutoPlayChange && typeof Editor !== 'undefined' && Editor.Message && Editor.Message.removeBroadcastListener) {
        Editor.Message.removeBroadcastListener('auto-play-audio:changed', panel.onAutoPlayChange);
        Editor.Message.removeBroadcastListener('auto-play-audio:stop', panel.onStopAudio);
        Editor.Message.removeBroadcastListener('auto-play-audio:play-asset', panel.onPlayAsset);
    }
};
