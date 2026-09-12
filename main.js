'use strict';

let isAutoPlayEnabled = true;

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

module.exports = {
    async load() {
        console.log('[Auto Play Audio] Extension đã sẵn sàng hoạt động.');
        await loadProfile();
    },

    unload() {
        if (typeof Editor !== 'undefined' && Editor.Message) {
            Editor.Message.broadcast('auto-play-audio:stop');
        }
        console.log('[Auto Play Audio] Extension đã được gỡ tải.');
    },

    methods: {
        onSelectionUnselect(type) {
            if (type === 'asset' && typeof Editor !== 'undefined' && Editor.Message) {
                Editor.Message.broadcast('auto-play-audio:stop');
            }
        },

        getAutoPlay() {
            return isAutoPlayEnabled;
        },

        async setAutoPlay(val) {
            isAutoPlayEnabled = !!val;
            await saveProfile();
            if (typeof Editor !== 'undefined' && Editor.Message) {
                Editor.Message.broadcast('auto-play-audio:changed', isAutoPlayEnabled);
                if (!isAutoPlayEnabled) {
                    Editor.Message.broadcast('auto-play-audio:stop');
                }
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
            if (typeof Editor !== 'undefined' && Editor.Message) {
                Editor.Message.broadcast('auto-play-audio:stop');
            }
            console.log('[Auto Play Audio] Đã dừng âm thanh.');
        }
    }
};
