# Cocos Auto Play Audio

Extension dành cho **Cocos Creator 3.x** giúp tự động phát (preview) âm thanh ngay khi click/chọn vào asset audio (`.wav`, `.mp3`, `.ogg`, `.m4a`...) trong panel Assets tương tự như tính năng trên **Unity**.

---

## 🎯 Tính năng

1. **Auto Play on Click (Tự động phát khi chạm vào asset):**
   - Click chuột vào bất kỳ file âm thanh nào trong panel Assets, âm thanh sẽ tự động được phát ngay lập tức.
   - Hỗ trợ di chuyển bằng phím mũi tên lên/xuống (Up/Down) trong Assets panel để duyệt nhanh toàn bộ thư viện SFX/BGM.
2. **Tùy chọn Bật/Tắt ngay trên Inspector (Unity Style):**
   - Khi chọn một file âm thanh, trong panel Inspector sẽ hiển thị trực tiếp một tùy chọn **Auto Play [x]** cùng nút **Stop (⏹)**.
   - Bạn có thể tick hoặc bỏ tick bất kỳ lúc nào ngay trên Inspector để bật/tắt tính năng tự động phát.
   - Trạng thái được lưu tự động (persistent) qua `Editor.Profile`.
3. **Auto Stop (Tự động dừng thông minh):**
   - Khi chọn sang file khác (ảnh, script, prefab) hoặc click vào node trong Scene/Hierarchy, âm thanh đang phát sẽ tự động ngắt.
   - Khi click sang 1 file âm thanh mới, âm thanh cũ sẽ dừng và âm thanh mới sẽ phát ngay lập tức.
4. **Menu Bật / Tắt tiện lợi:**
   - Menu **`Develop` -> `Audio Preview` -> `Toggle Auto-Play (Bật/Tắt)`**.
   - Menu **`Develop` -> `Audio Preview` -> `Stop Playing (Dừng phát)`**.

---

## 🛠️ Hướng dẫn kích hoạt & sử dụng

1. Mở Cocos Creator.
2. Vào **Extension** -> **Extension Manager** (Trình quản lý tiện ích) -> tab **Project** (Dự án).
3. Bấm icon **Reload** trên extension **`auto-play-audio`** để cập nhật phiên bản mới.
4. Click vào bất kỳ file âm thanh nào trong thư mục `assets/audio/`:
   - Bạn sẽ thấy âm thanh tự động phát.
   - Trong panel Inspector, ngay dưới trình phát nhạc sẽ có dòng **Auto Play** (với checkbox để bật/tắt tức thì).
