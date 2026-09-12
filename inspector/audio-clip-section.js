'use strict';

/**
 * Tìm kiếm phần tử <audio> trong Inspector panel
 * @param {HTMLElement} panel Panel hiện tại của extension
 * @returns {HTMLAudioElement|null}
 */
function findAudioElement(panel) {
    if (!panel) return null;

    // 1. Tìm trong parent (.content-section)
    const parent = panel.parentElement;
    if (parent) {
        // Tìm trong sibling ui-panels (audio-clip.js)
        const panels = parent.querySelectorAll('ui-panel');
        for (let i = 0; i < panels.length; i++) {
            const p = panels[i];
            if (p === panel) continue;
            const root = p.shadowRoot || p;
            const a = root.querySelector('audio');
            if (a) return a;
        }

        const a = parent.querySelector('audio');
        if (a) return a;
    }

    // 2. Tìm trong rootNode (nếu có ShadowRoot bao quanh)
    if (typeof panel.getRootNode === 'function') {
        const root = panel.getRootNode();
        if (root && root !== document) {
            const a = root.querySelector('audio');
            if (a) return a;
        }
    }

    // 3. Tìm trên toàn bộ document của Inspector window
    return document.querySelector('audio.audio') || document.querySelector('audio');
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

    if (typeof Editor !== 'undefined' && Editor.Message && Editor.Message.addBroadcastListener) {
        Editor.Message.addBroadcastListener('auto-play-audio:changed', panel.onAutoPlayChange);
        Editor.Message.addBroadcastListener('auto-play-audio:stop', panel.onStopAudio);
    }

    // Toggle checkbox
    const onToggle = async (event) => {
        const val = event.target ? event.target.value : panel.$.checkbox.value;
        panel._isAutoPlayEnabled = !!val;
        if (!panel._isAutoPlayEnabled && panel._currentAudioEl) {
            panel._currentAudioEl.pause();
        }
        try {
            await Editor.Message.request('auto-play-audio', 'set-auto-play', panel._isAutoPlayEnabled);
        } catch (e) {}
    };

    panel.$.checkbox.addEventListener('change', onToggle);
    panel.$.checkbox.addEventListener('confirm', onToggle);

    // Nút Replay
    panel.$.replayBtn.addEventListener('click', () => {
        const audioEl = findAudioElement(panel);
        if (audioEl) {
            audioEl.currentTime = 0;
            audioEl.play().catch(() => {});
        }
    });

    // Nút Stop
    panel.$.stopBtn.addEventListener('click', () => {
        const audioEl = findAudioElement(panel);
        if (audioEl) {
            audioEl.pause();
            audioEl.currentTime = 0;
        }
    });
};

exports.update = async function(assetList, metaList) {
    const panel = this;

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

    // Dừng phần tử audio cũ nếu có
    if (panel._currentAudioEl) {
        try {
            panel._currentAudioEl.pause();
            panel._currentAudioEl.currentTime = 0;
        } catch (e) {}
    }

    // Đợi DOM render <audio> tag trong panel audio-clip.js bên trên
    requestAnimationFrame(() => {
        const audioEl = findAudioElement(panel);
        if (!audioEl) return;

        panel._currentAudioEl = audioEl;

        // Nếu bật Auto Play, tự động kích hoạt phát trên chính thẻ <audio> của Inspector
        if (panel._isAutoPlayEnabled) {
            audioEl.currentTime = 0;
            const promise = audioEl.play();
            if (promise !== undefined) {
                promise.catch(() => {
                    // Nếu audio đang load metadata, chờ sự kiện canplay
                    audioEl.addEventListener('canplay', () => {
                        if (panel._isAutoPlayEnabled && panel._currentAudioEl === audioEl) {
                            audioEl.currentTime = 0;
                            audioEl.play().catch(() => {});
                        }
                    }, { once: true });
                });
            }
        }
    });
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
    }
};
