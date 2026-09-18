# 豆漿接案表 v2

網址：`https://jasper7523.github.io/soymilk-jobs/v2/`
舊版還在根目錄 `https://jasper7523.github.io/soymilk-jobs/`，兩邊互不影響。

## 現在的狀態：唯讀預覽

v2 頁面會先找試算表裡叫 `v2` 的分頁。找不到，就讀舊分頁即時換算成新格式給你看（狀態、報酬、地點是猜的），**不能存**。
試算表 ID 跟舊版共用同一個 `localStorage` 鍵，所以你和豆漿的手機上打開 `/v2/` 應該直接看得到資料，不用重設。

## 要能寫入：三步，做一次

1. **搬家**
   試算表 → 延伸功能 → Apps Script → 新增檔案，把 `gas_v2.js` 整個貼進去。
   上方函式選單選 `migrateFromV1` → 執行（第一次會要求授權）。
   跑完會多一個 `v2` 分頁。舊分頁不動。重跑會先清掉 `v2` 再搬一次。

2. **部署**
   部署 → 新增部署 → 類型「網頁應用程式」→ 執行身分「我」→ 存取權「任何人」→ 部署。
   複製那串 `https://script.google.com/macros/s/AKfy…/exec`。

3. **設定連結**
   組一條連結，用 LINE 傳給豆漿，她點一下就設好：

       https://jasper7523.github.io/soymilk-jobs/v2/#s=試算表ID&g=AKfy那串部署ID&me=豆漿

   你自己用 `&me=簡`。`g=` 可以只放 `/s/` 和 `/exec` 中間那段，也可以放完整網址。
   點開後網址列的 `#` 會自動清掉，不會留在書籤裡。

之後前台改版只推 `index.html`，Apps Script 不用再碰。

## 試算表 `v2` 分頁欄位

| 欄位 | 內容 |
|---|---|
| id | `J2026-0901-04`，主鍵，Apps Script 自動編 |
| title | 案件名稱，唯一必填 |
| status | `inquiry` 邀約中 / `scheduled` 待拍 / `to_deliver` 待交 / `to_publish` 待發 / `done` 結案 / `declined` 婉拒 |
| source | 邀約 / 報名 |
| tag | KOC、探店、拍攝… 自由文字 |
| shoot_date | `2026/09/17 19:30`、`2026/09/15 全天`、`2026/08/11 半天`，純文字 |
| location | 地址或店名 |
| contact | IG @帳號、LINE ID |
| pay_type | 有酬 / 互惠 / 兩者 / 未定 |
| pay_amount | 數字 |
| deliverable | 要交什麼 |
| due_deliver | 交件期限 `YYYY/MM/DD` |
| due_publish | 發文期限 `YYYY/MM/DD` |
| post_url | 發文連結，填了自動結案 |
| raw_message | 廠商原始訊息整段 |
| note | 自己的備註 |
| pdf_url | 舊版附件 |
| created_at / updated_at / updated_by | 自動 |

## 頁面規則

- **要交的**：待交＋待發，照交件期限（沒填就用發文期限）排；逾期紅、三天內橘、沒填灰排最後。
- **接下來要拍**：待拍，照拍攝日期排。日期過了還在待拍 → 標「拍了嗎？」，不自動改。
- **邀約中**：照收到日，新的在上；超過 30 天變灰。
- **結案／婉拒**：折疊。
- 邀約中填了拍攝日期 → 自動變待拍。貼了發文連結 → 自動結案。
- 每次儲存後都重新讀試算表確認那筆真的在，不再前端假裝成功。
