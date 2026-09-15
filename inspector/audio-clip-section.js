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
    if (panel._syncTimer) {
        clearTimeout(panel._syncTimer);
        panel._syncTimer = null;
    }
    if (panel._stopDrawing) {
        panel._stopDrawing();
    }
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

    if (panel._syncTimer) {
        clearTimeout(panel._syncTimer);
        panel._syncTimer = null;
    }

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
                if (panel._startDrawing) panel._startDrawing();
            };

            const onPauseOrEnd = () => {
                if (panel._stopDrawing) panel._stopDrawing();
            };

            audioEl.addEventListener('play', onUserPlay);
            audioEl.addEventListener('pause', onPauseOrEnd);
            audioEl.addEventListener('ended', onPauseOrEnd);

            audioEl._autoPlayCleanup = () => {
                audioEl.removeEventListener('play', onUserPlay);
                audioEl.removeEventListener('pause', onPauseOrEnd);
                audioEl.removeEventListener('ended', onPauseOrEnd);
            };

            audioEl.loop = !!panel._isLoopEnabled;
            audioEl.playbackRate = panel._currentPitch || 1.0;
            audioEl.muted = false;

            // Kết nối Web Audio Analyser để vẽ waveform
            if (!audioEl._isAnalyzed) {
                audioEl._isAnalyzed = true;
                try {
                    if (!panel._audioCtx || panel._audioCtx.state === 'closed') {
                        panel._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                    }
                    // Resume context nếu bị suspended (autoplay policy) để analyser có dữ liệu
                    if (panel._audioCtx.state === 'suspended') {
                        panel._audioCtx.resume().catch(() => {});
                    }
                    const source = panel._audioCtx.createMediaElementSource(audioEl);
                    const analyser = panel._audioCtx.createAnalyser();
                    analyser.fftSize = 128;
                    const gain = panel._audioCtx.createGain();
                    gain.gain.value = 0; // Mute trên inspector để tránh trùng tiếng

                    source.connect(analyser);
                    analyser.connect(gain);
                    gain.connect(panel._audioCtx.destination);

                    audioEl._analyser = analyser;
                    audioEl._waveformMuted = true;
                } catch (e) {
                    console.warn('[Auto Play Audio] Waveform init error:', e);
                    audioEl.muted = true; // fallback an toàn
                }
            } else if (panel._audioCtx && panel._audioCtx.state === 'suspended') {
                panel._audioCtx.resume().catch(() => {});
            }

            try {
                audioEl.currentTime = 0;
            } catch (e) {}

            audioEl.play().then(() => {
                if (panel._startDrawing) panel._startDrawing();
            }).catch(() => {});
            return;
        }

        attempts++;
        if (attempts < maxAttempts) {
            panel._syncTimer = setTimeout(trySync, 40);
        }
    };

    panel._syncTimer = setTimeout(trySync, 50);
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

    <ui-prop class="pitch-prop">
        <ui-label slot="label" value="Pitch / Speed" tooltip="Tốc độ và độ cao âm thanh (0.5x - 2.0x)"></ui-label>
        <div slot="content" class="pitch-content">
            <ui-slider class="pitch-slider" min="0.5" max="2.0" step="0.05" value="1.0"></ui-slider>
            <span class="pitch-val">1.00x</span>
            <ui-button class="pitch-reset-btn tiny transparent" tooltip="Đặt lại về mặc định 1.0x">
                <ui-icon value="reset"></ui-icon>
            </ui-button>
        </div>
    </ui-prop>

    <ui-prop class="volume-prop">
        <ui-label slot="label" value="Volume" tooltip="Âm lượng preview (0% - 100%)"></ui-label>
        <div slot="content" class="volume-content">
            <ui-slider class="volume-slider" min="0" max="1" step="0.05" value="1.0"></ui-slider>
            <span class="volume-val">100%</span>
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
.audio-clip-autoplay-wrapper .pitch-prop {
    margin-top: 2px;
}
.audio-clip-autoplay-wrapper .pitch-content {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
}
.audio-clip-autoplay-wrapper .volume-content {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
}
.audio-clip-autoplay-wrapper .volume-slider {
    flex: 1;
}
.audio-clip-autoplay-wrapper .volume-val {
    font-size: 11px;
    font-family: monospace;
    color: var(--color-normal-fill-font, #ccc);
    min-width: 36px;
    text-align: right;
}
.audio-clip-autoplay-wrapper .pitch-slider {
    flex: 1;
}
.audio-clip-autoplay-wrapper .pitch-val {
    font-size: 11px;
    font-family: monospace;
    color: var(--color-normal-fill-font, #ccc);
    min-width: 36px;
    text-align: right;
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
    pitchSlider: '.pitch-slider',
    pitchVal: '.pitch-val',
    pitchResetBtn: '.pitch-reset-btn',
    volumeSlider: '.volume-slider',
    volumeVal: '.volume-val',
    canvas: '#waveform-canvas'
};

exports.ready = function() {
    const panel = this;
    panel._isAutoPlayEnabled = true;
    panel._isLoopEnabled = false;
    panel._currentPitch = 1.0;
    panel._currentVolume = 1.0;
    panel._currentAudioEl = null;
    panel._lastAssetUuid = null;
    panel._drawReq = null;
    panel._isDrawing = false;
    panel._syncTimer = null;

    const ctx2d = panel.$.canvas.getContext('2d');
    const bufferLength = 64; // 128 fftSize -> 64 frequency bins
    const dataArray = new Uint8Array(bufferLength); // Tái sử dụng mảng cố định, chống GC pressure

    const renderFlatLine = () => {
        ctx2d.clearRect(0, 0, panel.$.canvas.width, panel.$.canvas.height);
        ctx2d.fillStyle = '#333';
        ctx2d.fillRect(0, panel.$.canvas.height / 2, panel.$.canvas.width, 1);
    };

    // Vẽ thanh ban đầu
    renderFlatLine();

    const drawWaveform = () => {
        if (!panel._isDrawing) return;
        panel._drawReq = requestAnimationFrame(drawWaveform);
        
        const analyser = panel._currentAudioEl && panel._currentAudioEl._analyser;
        if (!analyser || (panel._currentAudioEl && panel._currentAudioEl.paused)) {
            panel._stopDrawing();
            return;
        }

        analyser.getByteFrequencyData(dataArray);

        ctx2d.clearRect(0, 0, panel.$.canvas.width, panel.$.canvas.height);

        // Fix overflow: chia đều canvas cho 64 bins (trước đây *2.5 gây tràn ~812px trên canvas 300px)
        const slotW = panel.$.canvas.width / bufferLength;
        const barWidth = Math.max(1, slotW - 1);
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * panel.$.canvas.height;
            const r = barHeight + (25 * (i/bufferLength));
            const g = 150 + (100 * (i/bufferLength));
            const b = 255;

            ctx2d.fillStyle = `rgb(${r},${g},${b})`;
            ctx2d.fillRect(x, panel.$.canvas.height - barHeight, barWidth, barHeight);
            x += slotW;
        }
    };

    panel._startDrawing = () => {
        if (!panel._isDrawing) {
            panel._isDrawing = true;
            drawWaveform();
        }
    };

    panel._stopDrawing = () => {
        panel._isDrawing = false;
        if (panel._drawReq) {
            cancelAnimationFrame(panel._drawReq);
            panel._drawReq = null;
        }
        renderFlatLine();
    };

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

    panel.onPitchChange = (val) => {
        panel._currentPitch = Number(val) || 1.0;
        if (panel.$.pitchVal) panel.$.pitchVal.textContent = panel._currentPitch.toFixed(2) + 'x';
        if (panel.$.pitchSlider) panel.$.pitchSlider.value = panel._currentPitch;
        if (panel._currentAudioEl) panel._currentAudioEl.playbackRate = panel._currentPitch;
    };

    panel.onVolumeChange = (val) => {
        panel._currentVolume = Math.max(0, Math.min(1, Number(val)));
        if (isNaN(panel._currentVolume)) panel._currentVolume = 1.0;
        if (panel.$.volumeVal) panel.$.volumeVal.textContent = Math.round(panel._currentVolume * 100) + '%';
        if (panel.$.volumeSlider) panel.$.volumeSlider.value = panel._currentVolume;
    };

    panel.onStopAudio = () => safePauseOld(panel);
    panel.onPlayAsset = () => syncInspectorPlayer(panel);

    if (typeof Editor !== 'undefined' && Editor.Message && Editor.Message.addBroadcastListener) {
        Editor.Message.addBroadcastListener('auto-play-audio:changed', panel.onAutoPlayChange);
        Editor.Message.addBroadcastListener('auto-play-audio:loop-changed', panel.onLoopChange);
        Editor.Message.addBroadcastListener('auto-play-audio:pitch-changed', panel.onPitchChange);
        Editor.Message.addBroadcastListener('auto-play-audio:volume-changed', panel.onVolumeChange);
        Editor.Message.addBroadcastListener('auto-play-audio:stop', panel.onStopAudio);
        Editor.Message.addBroadcastListener('auto-play-audio:play-asset', panel.onPlayAsset);
    }

    // Dedupe change+confirm (Cocos UI phát cả 2 event cho 1 thao tác)
    const lastSent = { autoPlay: null, loop: null, pitch: null, volume: null };
    const onToggle = async (event) => {
        const val = event.target ? event.target.value : panel.$.checkbox.value;
        if (lastSent.autoPlay === !!val) return;
        lastSent.autoPlay = !!val;
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
        if (lastSent.loop === !!val) return;
        lastSent.loop = !!val;
        panel._isLoopEnabled = !!val;
        if (panel._currentAudioEl) panel._currentAudioEl.loop = panel._isLoopEnabled;
        try { await Editor.Message.request('auto-play-audio', 'set-loop', panel._isLoopEnabled); } catch (e) {}
    };
    panel.$.loopCheckbox.addEventListener('change', onLoopToggle);
    panel.$.loopCheckbox.addEventListener('confirm', onLoopToggle);

    const onPitchUpdate = async (val) => {
        val = Math.max(0.5, Math.min(2.0, Math.round(Number(val) * 100) / 100));
        if (lastSent.pitch === val) return;
        lastSent.pitch = val;
        panel._currentPitch = val;
        if (panel.$.pitchVal) panel.$.pitchVal.textContent = val.toFixed(2) + 'x';
        if (panel.$.pitchSlider) panel.$.pitchSlider.value = val;
        if (panel._currentAudioEl) panel._currentAudioEl.playbackRate = val;
        try {
            await Editor.Message.request('auto-play-audio', 'set-pitch', val);
        } catch (e) {}
    };

    if (panel.$.pitchSlider) {
        panel.$.pitchSlider.addEventListener('change', (e) => onPitchUpdate(e.target.value));
        panel.$.pitchSlider.addEventListener('confirm', (e) => onPitchUpdate(e.target.value));
    }
    if (panel.$.pitchResetBtn) {
        panel.$.pitchResetBtn.addEventListener('click', () => onPitchUpdate(1.0));
    }

    const onVolumeUpdate = async (val) => {
        val = Math.max(0, Math.min(1, Math.round(Number(val) * 100) / 100));
        if (isNaN(val)) val = 1.0;
        if (lastSent.volume === val) return;
        lastSent.volume = val;
        panel._currentVolume = val;
        if (panel.$.volumeVal) panel.$.volumeVal.textContent = Math.round(val * 100) + '%';
        if (panel.$.volumeSlider) panel.$.volumeSlider.value = val;
        try {
            await Editor.Message.request('auto-play-audio', 'set-volume', val);
        } catch (e) {}
    };

    if (panel.$.volumeSlider) {
        panel.$.volumeSlider.addEventListener('change', (e) => onVolumeUpdate(e.target.value));
        panel.$.volumeSlider.addEventListener('confirm', (e) => onVolumeUpdate(e.target.value));
    }

    panel.$.replayBtn.addEventListener('click', async () => {
        if (panel.currentAsset && panel.currentAsset.file) {
            safePauseOld(panel);
            try { await Editor.Message.request('auto-play-audio', 'play-background-audio', panel.currentAsset.file, true); } catch (e) {}
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
    const nextUuid = (assetList && assetList.length > 0 && assetList[0].uuid) ? assetList[0].uuid : null;
    const isSameAsset = nextUuid && nextUuid === panel._lastAssetUuid;
    if (assetList && assetList.length > 0) {
        panel.currentAsset = assetList[0];
        panel._lastAssetUuid = nextUuid;
    } else {
        panel.currentAsset = null;
        panel._lastAssetUuid = null;
    }

    try {
        const enabled = await Editor.Message.request('auto-play-audio', 'get-auto-play');
        if (typeof enabled === 'boolean') panel._isAutoPlayEnabled = enabled;
        if (panel.$.checkbox) panel.$.checkbox.value = panel._isAutoPlayEnabled;

        const loopEnabled = await Editor.Message.request('auto-play-audio', 'get-loop');
        if (typeof loopEnabled === 'boolean') panel._isLoopEnabled = loopEnabled;
        if (panel.$.loopCheckbox) panel.$.loopCheckbox.value = panel._isLoopEnabled;

        const pitchVal = await Editor.Message.request('auto-play-audio', 'get-pitch');
        if (typeof pitchVal === 'number' && !isNaN(pitchVal)) {
            panel._currentPitch = pitchVal;
            if (panel.$.pitchVal) panel.$.pitchVal.textContent = panel._currentPitch.toFixed(2) + 'x';
            if (panel.$.pitchSlider) panel.$.pitchSlider.value = panel._currentPitch;
        }

        const volVal = await Editor.Message.request('auto-play-audio', 'get-volume');
        if (typeof volVal === 'number' && !isNaN(volVal)) {
            panel._currentVolume = Math.max(0, Math.min(1, volVal));
            if (panel.$.volumeVal) panel.$.volumeVal.textContent = Math.round(panel._currentVolume * 100) + '%';
            if (panel.$.volumeSlider) panel.$.volumeSlider.value = panel._currentVolume;
        }
    } catch (e) {}

    // Tránh re-sync gây nháy khi update() fire nhiều lần cho cùng asset
    if (isSameAsset) return;
    safePauseOld(panel);
    syncInspectorPlayer(panel);
};

exports.close = function() {
    const panel = this;
    if (panel._syncTimer) {
        clearTimeout(panel._syncTimer);
        panel._syncTimer = null;
    }
    safePauseOld(panel);
    panel._currentAudioEl = null;
    panel.currentAsset = null;
    panel._lastAssetUuid = null;

    if (panel._stopDrawing) {
        panel._stopDrawing();
    }

    // Đóng AudioContext khi unmount để tránh rò rỉ AudioContext trong Chromium renderer
    if (panel._audioCtx && panel._audioCtx.state !== 'closed') {
        try {
            panel._audioCtx.close();
        } catch (e) {}
        panel._audioCtx = null;
    }

    if (typeof Editor !== 'undefined' && Editor.Message && Editor.Message.removeBroadcastListener) {
        if (panel.onAutoPlayChange) Editor.Message.removeBroadcastListener('auto-play-audio:changed', panel.onAutoPlayChange);
        if (panel.onLoopChange) Editor.Message.removeBroadcastListener('auto-play-audio:loop-changed', panel.onLoopChange);
        if (panel.onPitchChange) Editor.Message.removeBroadcastListener('auto-play-audio:pitch-changed', panel.onPitchChange);
        if (panel.onVolumeChange) Editor.Message.removeBroadcastListener('auto-play-audio:volume-changed', panel.onVolumeChange);
        if (panel.onStopAudio) Editor.Message.removeBroadcastListener('auto-play-audio:stop', panel.onStopAudio);
        if (panel.onPlayAsset) Editor.Message.removeBroadcastListener('auto-play-audio:play-asset', panel.onPlayAsset);
    }
};
