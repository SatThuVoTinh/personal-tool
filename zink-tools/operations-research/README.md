# Hướng dẫn Định dạng Bài toán Nghiên cứu Vận hành (zink_operations_research)

Tài liệu này hướng dẫn chi tiết cách thức đặc tả bài toán nghiên cứu vận hành và luồng mạng (Operations Research & Network Flows) bằng tiếng Việt, tuần tự theo đúng lược đồ [`contracts/tools/zink-operations-research.schema.json`](../contracts/tools/zink-operations-research.schema.json).

---

## 1. Giới thiệu & Vai trò

`zink_operations_research` là một **năng lực đặc tả bài toán (schema-only capability)** thuộc Stack 4 và Stack 5, chuẩn hóa bài toán quy hoạch chuỗi cung ứng, định tuyến phương tiện (VRP) và luồng mạng cực đại.

- **Lược đồ hợp đồng:** [`contracts/tools/zink-operations-research.schema.json`](../contracts/tools/zink-operations-research.schema.json).

---

## 2. Cấu trúc Mô hình Hóa Luồng Mạng Chuỗi Cung ứng

Mô hình định nghĩa đồ thị mạng lưới phân phối:

- **Các nút mạng (`nodes`):** Bao gồm nhà máy (`PLANT`), kho trung chuyển (`WAREHOUSE`), và điểm tiêu thụ (`CUSTOMER`).
- **Các cung mạng (`edges` / `arcs`):** Cung đường kết nối giữa hai nút, kèm chi phí vận chuyển đơn vị và năng lực vận chuyển tối đa (`capacity`).
- **Cung - cầu tại nút (`supply_demand`):** Nguồn cung dương tại nhà máy và nhu cầu âm tại điểm tiêu thụ.

---

## 3. Hướng dẫn Tạo Đặc tả Từng bước qua JSON

```json
{
  "network_id": "sc_distribution_network_q3",
  "nodes": [
    { "id": "factory_01", "type": "SUPPLY", "capacity": 1000 },
    { "id": "warehouse_01", "type": "TRANSSHIPMENT", "capacity": 800 },
    { "id": "market_north", "type": "DEMAND", "demand": 600 }
  ],
  "arcs": [
    {
      "from": "factory_01",
      "to": "warehouse_01",
      "cost_per_unit": 3.5,
      "capacity": 800
    },
    {
      "from": "warehouse_01",
      "to": "market_north",
      "cost_per_unit": 2.0,
      "capacity": 600
    }
  ]
}
```
