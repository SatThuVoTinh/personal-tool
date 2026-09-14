# Thư mục Gốc Lưu trữ Kỹ năng (Canonical Skills Root)

Thư mục này là nơi lưu trữ chính thức các kỹ năng phân tích đã được chuẩn hóa và phê duyệt trong **Zink Skill Store**.

Thư mục này được thiết kế để giữ sạch sẽ và trống rỗng cho đến khi có kỹ năng thực tế đầu tiên được chủ sở hữu (owner) phê duyệt và tích hợp vào hệ thống. Lệnh `node zink-skill-store/bin/skill-store.mjs validate` chấp nhận catalog rỗng này là hoàn toàn hợp lệ (`status: valid, manifest_count: 0`).

Mọi phiên bản kỹ năng khi được bổ sung vào đây bắt buộc phải tuân thủ nghiêm ngặt cấu trúc phân cấp, quy tắc đặt tên slug và hợp đồng `manifest.json` được quy định chi tiết tại [README.md chính của Skill Store](../README.md).
