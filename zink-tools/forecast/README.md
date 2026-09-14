# Hướng dẫn Định dạng Bài toán Dự báo Chuỗi Thời gian (zink_forecast)

Tài liệu này hướng dẫn chi tiết cách thức đặc tả bài toán dự báo chuỗi thời gian bằng tiếng Việt, tuần tự theo đúng lược đồ [`contracts/tools/zink-forecast.schema.json`](../contracts/tools/zink-forecast.schema.json).

---

## 1. Giới thiệu & Vai trò

`zink_forecast` là một **năng lực đặc tả bài toán (schema-only capability)** thuộc Stack 4 (Intelligence) và Stack 5 (Decision), không phải là công cụ thực thi trực tiếp trong phiên bản V1.

- **Mục tiêu:** Định nghĩa chuẩn hóa cấu trúc đầu vào và đầu ra cho các bài toán dự báo nhu cầu (demand forecasting), doanh thu hoặc tồn kho trước khi chuyển giao cho compute ngoại vi.
- **Lược đồ hợp đồng:** [`contracts/tools/zink-forecast.schema.json`](../contracts/tools/zink-forecast.schema.json).

---

## 2. Cấu trúc Đặc tả Đầu vào Chuẩn (Problem Specification)

Một bài toán dự báo hợp lệ phải xác định:

- `series_id`: Định danh chuỗi thời gian (ví dụ: `SKU-WH01-DEMAND`).
- `frequency`: Tần suất chuỗi dữ liệu (`DAILY`, `WEEKLY`, `MONTHLY`).
- `horizon`: Khoảng thời gian cần dự báo (số bước về tương lai).
- `historical_data`: Mảng các điểm dữ liệu lịch sử gồm `timestamp` và `value`.
- `exogenous_variables`: (Tùy chọn) Biến ngoại sinh như ngày lễ, khuyến mãi.

---

## 3. Hướng dẫn Tạo Đặc tả Từng bước qua JSON

```json
{
  "series_id": "DEMAND_SKU_1042",
  "frequency": "DAILY",
  "horizon": 30,
  "confidence_interval": 0.95,
  "historical_data": [
    { "timestamp": "2026-08-01", "value": 120.0 },
    { "timestamp": "2026-08-02", "value": 135.5 },
    { "timestamp": "2026-08-03", "value": 128.0 }
  ],
  "model_candidate": "ARIMA"
}
```

Dữ liệu đặc tả này sau đó được nạp vào tầng Silver/Gold và chuyển giao cho compute ngoại vi (như Kaggle hoặc Databricks) qua Mẫu điều phối P6 để huấn luyện hoặc suy luận.
