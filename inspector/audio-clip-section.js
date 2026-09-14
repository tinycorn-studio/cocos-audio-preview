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
 */
function syncInspectorPlayer(panel) {
    if (!panel._isAutoPlayEnabled) return;

    let attempts = 0;
    const maxAttempts = 15;

    const trySync = () => {
        if (!panel._isAutoPlayEnabled) return;

        const audioEl = getAudioElement(panel);
        if (audioEl) {
            if (panel._currentAudioEl && panel._currentAudioEl !== audioEl) {
                safePauseOld(panel);
            }

            panel._currentAudioEl = audioEl;

            if (audioEl._autoPlayCleanup) {
                audioEl._autoPlayCleanup();
            }

            const onUserPlay = () => {
                if (!audioEl.muted && !audioEl._waveformMuted) {
                    try {
                        Editor.Message.request('auto-play-audio', 'stop-background-audio');
                    } catch (e) {}
                }
            };

            audioEl.addEventListener('play', onUserPlay);
            audioEl._autoPlayCleanup = () => {
                audioEl.removeEventListener('play', onUserPlay);
            };

            audioEl.loop = !!panel._isLoopEnabled;
            audioEl.muted = false;

            if (!audioEl._isAnalyzed) {
                audioEl._isAnalyzed = true;
                try {
                    if (!panel._audioCtx) {
                        panel._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                    }
                    const source = panel._audioCtx.createMediaElementSource(audioEl);
                    const analyser = panel._audioCtx.createAnalyser();
                    analyser.fftSize = 128;
                    const gain = panel._audioCtx.createGain();
                    gain.gain.value = 0; // Mute in inspector!
                    
                    source.connect(analyser);
                    analyser.connect(gain);
                    gain.connect(panel._audioCtx.destination);
                    
                    audioEl._analyser = analyser;
                    audioEl._waveformMuted = true;
                } catch (e) {
                    console.warn('[Auto Play Audio] Waveform init error:', e);
                    audioEl.muted = true; // fallback
                }
            }

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
            
            <div class="loop-container">
                <ui-checkbox class="loop-checkbox" tooltip="Phát lặp lại (Loop)"></ui-checkbox>
                <span>Loop</span>
            </div>

            <ui-button class="replay-btn tiny transparent" tooltip="Phát lại từ đầu (Replay)">
                <ui-icon value="play"></ui-icon>
            </ui-button>
            <ui-button class="stop-btn tiny transparent" tooltip="Dừng âm thanh (Stop)">
                <ui-icon value="stop"></ui-icon>
            </ui-button>
        </div>
    </ui-prop>
    <canvas id="waveform-canvas" width="300" height="40"></canvas>
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
.audio-clip-autoplay-wrapper .loop-container {
    display: flex; 
    align-items: center; 
    border-left: 1px solid var(--color-normal-border, #444); 
    padding-left: 8px;
    margin-right: 4px;
}
.audio-clip-autoplay-wrapper .loop-container span {
    font-size: 12px; 
    margin-left: 4px;
    color: var(--color-normal-fill-font, #ccc);
}
.audio-clip-autoplay-wrapper ui-button {
    cursor: pointer;
}
#waveform-canvas {
    width: 100%;
    height: 40px;
    margin-top: 8px;
    border-radius: 4px;
    background: var(--color-normal-fill-emphasis, #111);
    display: block;
    box-shadow: inset 0 0 4px rgba(0,0,0,0.5);
}
`;

exports.$ = {
    container: '.audio-clip-autoplay-wrapper',
    checkbox: '.autoplay-checkbox',
    loopCheckbox: '.loop-checkbox',
    replayBtn: '.replay-btn',
    stopBtn: '.stop-btn',
    canvas: '#waveform-canvas'
};

exports.ready = function() {
    const panel = this;
    panel._isAutoPlayEnabled = true;
    panel._isLoopEnabled = false;
    panel._currentAudioEl = null;
    panel._drawReq = null;

    const ctx2d = panel.$.canvas.getContext('2d');
    
    const drawWaveform = () => {
        panel._drawReq = requestAnimationFrame(drawWaveform);
        
        if (!panel._currentAudioEl || !panel._currentAudioEl._analyser) {
            ctx2d.clearRect(0, 0, panel.$.canvas.width, panel.$.canvas.height);
            ctx2d.fillStyle = '#333';
            ctx2d.fillRect(0, panel.$.canvas.height / 2, panel.$.canvas.width, 1);
            return;
        }

        const analyser = panel._currentAudioEl._analyser;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        ctx2d.clearRect(0, 0, panel.$.canvas.width, panel.$.canvas.height);
        
        const barWidth = (panel.$.canvas.width / bufferLength) * 2.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * panel.$.canvas.height;
            const r = barHeight + (25 * (i/bufferLength));
            const g = 150 + (100 * (i/bufferLength));
            const b = 255;
            
            ctx2d.fillStyle = `rgb(${r},${g},${b})`;
            ctx2d.fillRect(x, panel.$.canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    };
    drawWaveform();

    panel.onAutoPlayChange = (enabled) => {
        panel._isAutoPlayEnabled = !!enabled;
        if (panel.$.checkbox) panel.$.checkbox.value = panel._isAutoPlayEnabled;
        if (!panel._isAutoPlayEnabled) safePauseOld(panel);
    };

    panel.onLoopChange = (enabled) => {
        panel._isLoopEnabled = !!enabled;
        if (panel.$.loopCheckbox) panel.$.loopCheckbox.value = panel._isLoopEnabled;
        if (panel._currentAudioEl) panel._currentAudioEl.loop = panel._isLoopEnabled;
    };

    panel.onStopAudio = () => safePauseOld(panel);
    panel.onPlayAsset = () => syncInspectorPlayer(panel);

    if (typeof Editor !== 'undefined' && Editor.Message && Editor.Message.addBroadcastListener) {
        Editor.Message.addBroadcastListener('auto-play-audio:changed', panel.onAutoPlayChange);
        Editor.Message.addBroadcastListener('auto-play-audio:loop-changed', panel.onLoopChange);
        Editor.Message.addBroadcastListener('auto-play-audio:stop', panel.onStopAudio);
        Editor.Message.addBroadcastListener('auto-play-audio:play-asset', panel.onPlayAsset);
    }

    const onToggle = async (event) => {
        const val = event.target ? event.target.value : panel.$.checkbox.value;
        panel._isAutoPlayEnabled = !!val;
        if (!panel._isAutoPlayEnabled) {
            safePauseOld(panel);
            try { await Editor.Message.request('auto-play-audio', 'stop-background-audio'); } catch (e) {}
        }
        try { await Editor.Message.request('auto-play-audio', 'set-auto-play', panel._isAutoPlayEnabled); } catch (e) {}
    };
    panel.$.checkbox.addEventListener('change', onToggle);
    panel.$.checkbox.addEventListener('confirm', onToggle);

    const onLoopToggle = async (event) => {
        const val = event.target ? event.target.value : panel.$.loopCheckbox.value;
        panel._isLoopEnabled = !!val;
        if (panel._currentAudioEl) panel._currentAudioEl.loop = panel._isLoopEnabled;
        try { await Editor.Message.request('auto-play-audio', 'set-loop', panel._isLoopEnabled); } catch (e) {}
    };
    panel.$.loopCheckbox.addEventListener('change', onLoopToggle);
    panel.$.loopCheckbox.addEventListener('confirm', onLoopToggle);

    panel.$.replayBtn.addEventListener('click', async () => {
        if (panel.currentAsset && panel.currentAsset.file) {
            safePauseOld(panel);
            try { await Editor.Message.request('auto-play-audio', 'play-background-audio', panel.currentAsset.file); } catch (e) {}
            syncInspectorPlayer(panel);
        }
    });

    panel.$.stopBtn.addEventListener('click', async () => {
        safePauseOld(panel);
        try { await Editor.Message.request('auto-play-audio', 'stop-background-audio'); } catch (e) {}
    });
};

exports.update = async function(assetList, metaList) {
    const panel = this;
    if (assetList && assetList.length > 0) panel.currentAsset = assetList[0];

    try {
        const enabled = await Editor.Message.request('auto-play-audio', 'get-auto-play');
        if (typeof enabled === 'boolean') panel._isAutoPlayEnabled = enabled;
        if (panel.$.checkbox) panel.$.checkbox.value = panel._isAutoPlayEnabled;

        const loopEnabled = await Editor.Message.request('auto-play-audio', 'get-loop');
        if (typeof loopEnabled === 'boolean') panel._isLoopEnabled = loopEnabled;
        if (panel.$.loopCheckbox) panel.$.loopCheckbox.value = panel._isLoopEnabled;
    } catch (e) {}

    safePauseOld(panel);
    syncInspectorPlayer(panel);
};

exports.close = function() {
    const panel = this;
    safePauseOld(panel);
    panel._currentAudioEl = null;

    if (panel._drawReq) {
        cancelAnimationFrame(panel._drawReq);
        panel._drawReq = null;
    }

    if (typeof Editor !== 'undefined' && Editor.Message && Editor.Message.removeBroadcastListener) {
        if (panel.onAutoPlayChange) Editor.Message.removeBroadcastListener('auto-play-audio:changed', panel.onAutoPlayChange);
        if (panel.onLoopChange) Editor.Message.removeBroadcastListener('auto-play-audio:loop-changed', panel.onLoopChange);
        if (panel.onStopAudio) Editor.Message.removeBroadcastListener('auto-play-audio:stop', panel.onStopAudio);
        if (panel.onPlayAsset) Editor.Message.removeBroadcastListener('auto-play-audio:play-asset', panel.onPlayAsset);
    }
};
