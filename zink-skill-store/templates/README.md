# Kho Lưu trữ Template Chuẩn (Template Store)

Thư mục này quản lý các mẫu báo cáo tái sử dụng được chủ sở hữu xây dựng cho Excel và Power BI thuộc phạm vi quản trị của **Zink Skill Store**.

```text
templates/
├── excel/                      # Template bảng tính Excel chuẩn (.xlsx)
└── power-bi/                   # Template báo cáo Power BI chuẩn (.pbix)
```

### Nguyên tắc quản trị:

- **Tách biệt với Knowledgebase:** Template ở đây là các khung báo cáo cấu trúc, không phải tài liệu nghiên cứu tham chiếu.
- **Chỉ đọc (Read-only assets):** Các công cụ phân tích (`zink_excel`, `zink_power_bi`) đọc template này làm khung mẫu và xuất kết quả ra tệp mới, không sửa đổi trực tiếp tệp gốc.
