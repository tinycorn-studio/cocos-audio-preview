'use strict';

exports.template = /* html */`
<div class="audio-clip-autoplay-wrapper">
    <ui-prop class="autoplay-prop">
        <ui-label slot="label" value="Auto Play" tooltip="Tự động phát khi chạm/click vào file âm thanh (giống Unity)"></ui-label>
        <div slot="content" class="autoplay-content">
            <ui-checkbox class="autoplay-checkbox" tooltip="Bật/Tắt chế độ Auto-Play"></ui-checkbox>
            <ui-button class="stop-btn tiny transparent" tooltip="Dừng âm thanh">
                <ui-icon value="stop"></ui-icon>
            </ui-button>
        </div>
    </ui-prop>
</div>
`;

exports.style = /* css */`
.audio-clip-autoplay-wrapper {
    margin-top: -6px;
    margin-bottom: 8px;
    padding: 6px 4px 0 4px;
    border-top: 1px solid var(--color-normal-border, rgba(255, 255, 255, 0.08));
}
.audio-clip-autoplay-wrapper .autoplay-content {
    display: flex;
    align-items: center;
    gap: 12px;
}
.audio-clip-autoplay-wrapper ui-button {
    cursor: pointer;
}
`;

exports.$ = {
    container: '.audio-clip-autoplay-wrapper',
    checkbox: '.autoplay-checkbox',
    stopBtn: '.stop-btn'
};

exports.ready = function() {
    const panel = this;

    // Lắng nghe sự kiện thay đổi trạng thái từ main process hoặc panel khác
    panel.onAutoPlayChange = (enabled) => {
        if (panel.$.checkbox) {
            panel.$.checkbox.value = !!enabled;
        }
    };
    if (typeof Editor !== 'undefined' && Editor.Message && Editor.Message.addBroadcastListener) {
        Editor.Message.addBroadcastListener('auto-play-audio:changed', panel.onAutoPlayChange);
    }

    // Khi người dùng click toggle checkbox
    const onToggle = async (event) => {
        const val = event.target ? event.target.value : panel.$.checkbox.value;
        try {
            await Editor.Message.request('auto-play-audio', 'set-auto-play', val);
        } catch (e) {
            console.error('[Auto Play Audio] Lỗi cập nhật trạng thái:', e);
        }
    };

    panel.$.checkbox.addEventListener('change', onToggle);
    panel.$.checkbox.addEventListener('confirm', onToggle);

    // Nút dừng phát
    panel.$.stopBtn.addEventListener('click', async () => {
        try {
            await Editor.Message.request('auto-play-audio', 'stop-audio');
        } catch (e) {}
    });
};

exports.update = async function(assetList, metaList) {
    const panel = this;
    try {
        const enabled = await Editor.Message.request('auto-play-audio', 'get-auto-play');
        if (panel.$.checkbox) {
            panel.$.checkbox.value = !!enabled;
        }
    } catch (e) {}
};

exports.close = function() {
    const panel = this;
    if (panel.onAutoPlayChange && typeof Editor !== 'undefined' && Editor.Message && Editor.Message.removeBroadcastListener) {
        Editor.Message.removeBroadcastListener('auto-play-audio:changed', panel.onAutoPlayChange);
    }
};
