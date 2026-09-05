# 社團志願序選填與分發系統

為淡江高中設計的社團選社系統。學生在開放期間填 15 個志願，截止後由學校一鍵執行統一電腦分發（序列分發＋可重現抽籤），不再有「開放那一秒全校同時搶」的流量尖峰。

- **架構**：Cloudflare Workers + D1（免費額度足以應付 2,000 多名學生同時填寫），前端純 HTML/JS，無需自建伺服器。
- **登入**：學號＋密碼。匯入名單時系統自動產生密碼，後台可下載密碼名單或列印密碼條發給各班。
- **匯入**：學生名單與社團名單皆可直接上傳 Excel（.xlsx）或 CSV。
- **家長**：學生送出後可列印「志願確認單」存成 PDF；分發後可列印「分發結果通知單」，皆含家長簽名欄。
- **匯出**：分發結果（依班級／依社團）、志願原始資料、未填名單、社團熱門度，皆為可直接用 Excel 開啟的 CSV。
- **公平性**：分發使用公開的抽籤種子，同一種子必得同一結果，可事後驗證。

## 目錄

```
public/          學生頁 index.html、後台 admin.html、確認單 receipt.html、列印 print.html
src/index.js     API（Cloudflare Worker）
lib/             分發演算法、CSV、驗證共用程式
schema.sql       資料表
samples/         範例名單
scripts/         離線分發腳本
test/            單元測試（node --test）
```

## 一、首次部署（約 15 分鐘）

需要：Node.js 18+、一個免費的 [Cloudflare 帳號](https://dash.cloudflare.com/sign-up)。

```bash
npm install
npx wrangler login                      # 開瀏覽器授權
npx wrangler d1 create clubselect       # 建立資料庫，複製回傳的 database_id
```

把 `wrangler.toml` 裡的 `database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"` 換成上一步的 id，然後：

```bash
npx wrangler d1 execute clubselect --remote --file=schema.sql   # 建表
npx wrangler secret put ADMIN_PASSWORD    # 初始後台帳號 admin 的密碼
npx wrangler secret put SESSION_SECRET    # 任意長隨機字串（30 字以上），設定後不要更改
npx wrangler deploy
```

部署完成會得到 `https://clubselect.<你的帳號>.workers.dev`。學生頁在 `/`，後台在 `/admin`。

後台首次以帳號 `admin` 與剛設定的 `ADMIN_PASSWORD` 登入，接著到「管理帳號」頁為每位承辦老師建立各自的帳號。`admin` 是備援帳號，密碼只能用 `wrangler secret put ADMIN_PASSWORD` 更改。

> `SESSION_SECRET` 同時用於學生密碼雜湊。若更換，所有學生密碼會失效，需重新產生密碼名單。

### 綁定學校網域（建議）

1. 在 Cloudflare 後台 Workers & Pages → clubselect → Settings → Domains & Routes → Add → Custom Domain。
2. 若學校網域不在 Cloudflare 上，請學校資訊組在 DNS 加一筆 CNAME（例如 `club.tksh.ntpc.edu.tw` → Cloudflare 提供的目標），或改用自行購買的網域。
3. 沒有網域也可以直接使用 `workers.dev` 網址。

## 二、每學年操作流程

1. **匯入社團**：後台「社團」頁上傳 Excel／CSV。欄位：`社團代碼, 社團名稱, 類別, 名額, 限制年級, 指導老師, 地點, 簡介`。限制年級填 `7,8,9` 之類，留空表示不限。
2. **匯入學生**：後台「學生名單」頁上傳。欄位：`學號, 姓名, 班級, 年級, 座號, 密碼`。密碼欄留空則自動產生。**匯入後立即下載密碼名單或列印密碼條**，密碼只顯示這一次。
3. **設定開放時間**：「開放設定」頁選「依時間自動」並填開放／截止時間，或直接「強制開放」。可設定最少／最多志願數（預設 15/15）與公告。
4. **學生填寫**：學生用手機或電腦登入，點選加入志願、調整順序、送出，取得確認碼，可列印確認單給家長簽名。截止前可反覆修改。
5. **追蹤進度**：「總覽」看各班填寫率，「匯出」下載未填名單催交。
6. **截止後分發**：先把狀態改「強制關閉」，到「分發」頁輸入抽籤種子（例如 `114學年社團-第1次`）、選模式，先「試算」看額滿狀況，再「正式分發」。
7. **公布與匯出**：「匯出」下載依班級／依社團結果；可列印分發結果通知單；勾選「公布分發結果」讓學生登入自行查看與列印。
8. **學年結束**：「匯出／清除」清除志願與分發結果（或全部清除），符合個資保護。

### 分發模式

| 模式 | 說明 |
|---|---|
| 純隨機抽籤 | 所有已填志願的學生一起抽順位 |
| 高年級優先 | 高年級先抽，同年級內隨機 |
| 低年級優先 | 低年級先抽，同年級內隨機 |

抽籤順位確定後，依序讓每位學生進入其志願序中第一個「尚有名額且年級允許」的社團。15 個志願皆額滿者列為「志願皆額滿」，由學務處手動安置。

## 三、本機測試

```bash
cp .dev.vars.example .dev.vars          # 修改裡面的密碼
npm run db:init:local
npm run dev                             # http://localhost:6767，同一區網的人可用 http://<你的IP>:6767 連入
npm test                                # 單元測試
```

### 讓校外的人測試

不必改路由器，另開一個終端機執行：

```bash
npm run tunnel
```

第一次會下載 cloudflared（免費、不需帳號），接著印出一個 `https://xxxx.trycloudflare.com` 網址，把它給測試的人即可。關掉終端機網址就失效，適合短期測試。

指令裡的 `--config /dev/null` 是必要的：若電腦上已有 `~/.cloudflared/config.yml`（例如其他專案的具名通道），快速通道會誤讀該設定而一律回 404。

## 四、離線分發（備援）

若雲端無法使用，可將匯出的三個 CSV 在本機分發：

```bash
node scripts/allocate.mjs 學生名單.csv 社團填選統計.csv 志願序原始資料.csv 114社團-1 random 結果.csv
```

## 五、費用與容量

- Cloudflare Workers 免費額度：每日 10 萬次請求；D1 免費 5 GB。2,160 名學生全部在同一小時內填寫也只用到數千次請求。
- 唯一可能的費用是自訂網域（每年約新台幣 300–500 元），使用 `workers.dev` 網址則完全免費。

## 六、安全與個資

- 學生密碼以 SHA-256 加鹽雜湊儲存，資料庫外洩也無法還原密碼。
- 學生只能讀寫自己的志願；後台所有操作需管理帳號登入，管理者密碼同樣以雜湊儲存；清除資料需再輸入 `DELETE` 確認。
- 建議在 Cloudflare 後台的 Security → WAF 對 `/api/login` 加一條速率限制規則（免費方案可用），防止暴力猜密碼。
- 資料僅存學號、姓名、班級、座號與志願，學年結束請清除。
