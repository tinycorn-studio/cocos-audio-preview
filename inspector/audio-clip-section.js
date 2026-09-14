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
 * Dừng phần tử audio cũ một cách an toàn (không trigger onPause → stop-background)
 */
function safePauseOld(panel) {
    if (panel._currentAudioEl) {
        // Xóa event listeners TRƯỚC KHI pause để tránh onPause gọi stop-background-audio
        if (panel._currentAudioEl._autoPlayCleanup) {
            panel._currentAudioEl._autoPlayCleanup();
            panel._currentAudioEl._autoPlayCleanup = null;
        }
        try {
            panel._currentAudioEl.pause();
            panel._currentAudioEl.currentTime = 0;
        } catch (e) {}
    }
}

/**
 * Đồng bộ hóa thanh tiến trình của Inspector preview khi phát âm thanh
 * Chỉ phát muted trên thẻ <audio> của Inspector để thanh progress bar chạy theo.
 * Âm thanh thực tế được phát bởi background player trong main.js.
 */
function syncInspectorPlayer(panel) {
    if (!panel._isAutoPlayEnabled) return;

    let attempts = 0;
    const maxAttempts = 15;

    const trySync = () => {
        if (!panel._isAutoPlayEnabled) return;

        const audioEl = getAudioElement(panel);
        if (audioEl) {
            // Dừng audio cũ an toàn (không trigger stop-background)
            if (panel._currentAudioEl && panel._currentAudioEl !== audioEl) {
                safePauseOld(panel);
            }

            panel._currentAudioEl = audioEl;

            // Xóa event listener cũ nếu cùng element
            if (audioEl._autoPlayCleanup) {
                audioEl._autoPlayCleanup();
            }

            // Chỉ lắng nghe sự kiện khi NGƯỜI DÙNG bấm Play trực tiếp trên native controls (unmuted)
            const onUserPlay = () => {
                // Người dùng bấm Play trên native controls (unmuted) → dừng background player để tránh trùng tiếng
                if (!audioEl.muted) {
                    try {
                        Editor.Message.request('auto-play-audio', 'stop-background-audio');
                    } catch (e) {}
                }
            };

            audioEl.addEventListener('play', onUserPlay);

            audioEl._autoPlayCleanup = () => {
                audioEl.removeEventListener('play', onUserPlay);
            };

            // Bật muted = true trước khi gọi play để thanh tiến trình chạy theo
            // (Chromium cho phép muted play 100% mà không cần user gesture)
            audioEl.muted = true;
            audioEl.currentTime = 0;
            audioEl.play().catch(() => {});
            return;
        }

        attempts++;
        if (attempts < maxAttempts) {
            setTimeout(trySync, 40);
        }
    };

    setTimeout(trySync, 50);
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

    // Lắng nghe broadcast từ main process
    panel.onAutoPlayChange = (enabled) => {
        panel._isAutoPlayEnabled = !!enabled;
        if (panel.$.checkbox) {
            panel.$.checkbox.value = panel._isAutoPlayEnabled;
        }
        if (!panel._isAutoPlayEnabled) {
            safePauseOld(panel);
        }
    };

    panel.onStopAudio = () => {
        safePauseOld(panel);
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
            safePauseOld(panel);
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
        if (panel.currentAsset && panel.currentAsset.file) {
            safePauseOld(panel);
            try {
                await Editor.Message.request('auto-play-audio', 'play-background-audio', panel.currentAsset.file);
            } catch (e) {}
            syncInspectorPlayer(panel);
        }
    });

    // Nút Stop
    panel.$.stopBtn.addEventListener('click', async () => {
        safePauseOld(panel);
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

    // Dừng audio cũ trên inspector an toàn (KHÔNG gọi stop-background-audio ở đây!
    // vì main.js đã bắt đầu phát background audio trước khi Inspector update được gọi)
    safePauseOld(panel);

    // Đồng bộ thanh tiến trình (phát muted trên Inspector)
    syncInspectorPlayer(panel);
};

exports.close = function() {
    const panel = this;
    safePauseOld(panel);
    panel._currentAudioEl = null;

    if (typeof Editor !== 'undefined' && Editor.Message && Editor.Message.removeBroadcastListener) {
        if (panel.onAutoPlayChange) Editor.Message.removeBroadcastListener('auto-play-audio:changed', panel.onAutoPlayChange);
        if (panel.onStopAudio) Editor.Message.removeBroadcastListener('auto-play-audio:stop', panel.onStopAudio);
        if (panel.onPlayAsset) Editor.Message.removeBroadcastListener('auto-play-audio:play-asset', panel.onPlayAsset);
    }
};
