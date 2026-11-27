# Tile Stock Bot

A WhatsApp bot that answers stock questions for a tile dealer.

**Before:** dealers and staff message the admin on WhatsApp (`1055 pgvt`). The admin opens the godown Excel files, looks up the code and types back the stock and locations.

**Now:**

1. Every morning the admin uploads each godown's stock Excel. The Hubli godown has its own file, Mangalore its own, and so on.
2. When someone sends `1055 pgvt`, the bot replies within seconds:

```
*1055*
*PGVT · Premium · 600x600*
🏬 Hubli: *84 boxes*
   • SS06/21 – 46
   • SN 08 – 38
🏬 Mangalore: *77 boxes*
   • SS27 – 77
Total: *161 boxes*

*PGVT · Standard · 600x1200*
🏬 Hubli: *18 boxes*
   • SN 09 – 18

_Stock as on: Hubli, Mangalore 25 Nov_
```

The bot is linked to your **existing WhatsApp Business number** as a "linked device", the same way WhatsApp Web works. Your phone keeps working normally.

---

## What it can do

| | |
|---|---|
| **Godown-wise stock** | One Excel per godown. Uploading Hubli's file replaces only Hubli's stock. The other godowns are not touched. |
| **Always the newest data** | Each godown shows when it was last updated. If a godown was not updated today, every reply says so. A file older than the current one, or older than yesterday, gets a warning on upload. |
| **Understands your Excel** | Reads the godown sheets as they are: `COLOUR CODE / BATCH / SIZE / BOX / LOCATION`, one sheet per grade and size (`PRM 60X60 GVT & PGVT`, `STD 60X120`, …), and an "AS ON" date. It also handles TOTAL rows, section rows and extra helper columns. |
| **Understands questions** | `1055 pgvt`, `1055P`, `1005gvt`, `4029 GVT 60x60`, `5091 dc premium`, `1055 hubli`, `grand crema`, and many codes at once (one per line). Typos get "Did you mean …". |
| **Stays quiet in normal chat** | It only replies to stock questions. "ok thanks" or "call me" are ignored. Your own messages are never answered. |
| **Allowed numbers only** | Only people in the **People** list get replies in 1-to-1 chats. Unknown numbers get a polite message, at most once a day, or nothing if you turn that off. |
| **Groups** | Switch the bot on for chosen WhatsApp groups only. In those groups it replies to the question. |
| **Excel on WhatsApp** | The admin can send the Excel on WhatsApp instead of using the website. The godown is found from the file name (`HUBLI_…xlsx`) or from the caption (`Hubli`). |
| **Morning reminder** | At 10:00 (you can change it), if a godown is not updated, the Admin numbers get a WhatsApp message listing those godowns. |
| **Reports** | Questions per day, most-asked designs, designs asked for but out of stock, codes not found, who asks the most. Download as CSV. |
| **Admin page** | Clean, works on phone and computer. Pages: Home, Stock, WhatsApp, People, Reports, Settings. |

---

## Setup (one time)

You need a computer or server that stays on all day: an office PC, a small cloud server (₹400–800/month), or a Raspberry Pi.

### 1. Install

Install **Node.js 22 or newer** from <https://nodejs.org> (the "LTS" Windows Installer is fine).

**Windows, easiest:** download the code as a ZIP from GitHub, right-click it → **Extract All…**, open the `tile-stock-bot` folder and double-click **`Start-Stock-Bot.bat`**. The first time it installs everything and opens the password file in Notepad. After that, the same double-click starts the bot and opens the admin page.

**Windows (Command Prompt), by hand:**

1. Download the code as a ZIP from GitHub (log in first). Right-click the ZIP → **Extract All…** → choose `C:\` → **Extract**.
2. Open Command Prompt and run each line:

```bat
cd C:\Projects-claude-stoic-turing-yb3gwq\tile-stock-bot
npm install
copy .env.example .env
notepad .env
```

3. In Notepad, set `ADMIN_PASSWORD=` to a long password. Save and close.

The folder name above is for the download of branch `claude/stoic-turing-yb3gwq`. If you downloaded `main`, it is `C:\Projects-main\tile-stock-bot`.

**Mac / Linux:**

```bash
cd tile-stock-bot
npm install
cp .env.example .env
```

Open `.env` and set `ADMIN_PASSWORD` to a long password.

### 2. Start

```bash
npm start
```

Open the admin page at <http://localhost:3000> and log in.

To keep it running all the time and restart it after a reboot, use Docker (`docker compose up -d`) or pm2 (`npm i -g pm2 && pm2 start npm --name stock-bot -- start && pm2 save && pm2 startup`).

### 3. Link the shop's WhatsApp

On the admin page, open **WhatsApp**. On the shop phone, open **WhatsApp Business → ⋮ → Linked devices → Link a device** and scan the QR code.
If the admin page is open on the same phone, use **"Link with a code instead"**.

### 4. Add people and groups

- **People:** add dealers and staff. You can paste many at once. Mark office numbers as **Admin**: they can send the Excel on WhatsApp and they get the morning reminder.
- **WhatsApp → Groups:** switch on the groups where the bot should answer.

### 5. Upload the godown files

On **Home**, choose a godown's Excel. The godown is picked from the file name (`HUBLI_CERAMICK_…xlsx` → Hubli). The first time, confirm the new godown name. Do this for every godown.

---

## Daily routine for the admin

Every morning, upload each godown's Excel, either:

- **on the admin page** (Home → Upload), or
- **on WhatsApp:** send the file to the shop number's **"Message yourself"** chat, or from an Admin number. Keep the godown name in the file name or type it as the caption.

The bot replies with a summary (designs, boxes, "as on" date, warnings) and lists the godowns still to update.

WhatsApp commands for admins: **`status`** shows when each godown was updated. **`help`** shows how to ask.

---

## About the Excel files

No fixed template is needed. The bot looks for a header row and recognises common column names:

| Meaning | Column names it understands |
|---|---|
| Design | COLOUR CODE, Design No, Code, Item Code |
| Quantity | BOX, PHYSICAL STOCK, Closing Stock, Qty, Quantity |
| Batch / shade | BATCH, Shade, Lot |
| Size | SIZE (`600X600`, `BOX(1200X600)`, `794X1588` → 800x1600) |
| Rack | LOCATION, Rack, L.NO |

- **Grade** (Premium / Standard / Economy) comes from the sheet name (`PRM`, `STD`, `ECO`) or from the description (`[4029-XKS] ECO-PARANAT …`).
- **Type** (GVT / PGVT / DC) and **finish** (Shine / Matt / Nano) come from the code (`1055P-ESS-PGVT`) or the sheet name (`PREM DC 60X60`).
- The **stock date** comes from the title row (`… AS ON 25.11.2026`).
- Sheets without a design-code column (like `UITILITY`) are skipped and listed in the upload summary.

After each upload, the admin page shows which columns were used and the first rows, so you can check the result. Sample files are in `sample_data/` (`npm run sample` makes them again).

---

## Important: WhatsApp linked device

This bot connects like WhatsApp Web, using the open-source library [Baileys](https://github.com/WhiskeySockets/Baileys). This is **not an official WhatsApp API**, and WhatsApp can restrict numbers that act like bots. To keep the risk low, the bot:

- only **replies** to messages people send. It never sends bulk or promotional messages.
- answers only allowed numbers and groups you switch on.
- limits itself to 12 replies per chat per minute.

Also, open WhatsApp Business on the shop phone at least once every 2 weeks so the link stays active.

If you ever want the official route, Meta's "Coexistence" lets the same number use the WhatsApp Business app and the official Cloud API through a Meta partner. The bot's core does not depend on Baileys, so the WhatsApp part can be swapped later.

---

## For developers

```bash
npm test            # 29 tests: Excel reading, replies, bot rules, reminder, web API
npm run sample      # make example godown files in sample_data/
```

| File | Job |
|---|---|
| `src/importer.js`, `src/describe.js`, `src/sizes.js` | Read the Excel and split codes like `1055P-ESS-PGVT` into design, type, grade and size |
| `src/search.js`, `src/replies.js`, `src/vocab.js` | Understand the question and write the reply |
| `src/bot.js` | Who gets a reply, groups, Excel over WhatsApp, admin commands |
| `src/whatsapp.js` | Baileys connection: QR, pairing code, reconnect, sending |
| `src/stock-service.js` | Godowns, uploads, "updated today" |
| `src/reminder.js` | Morning reminder |
| `src/web.js`, `public/` | Admin page and API |
| `src/db.js` | SQLite storage (Node's built-in `node:sqlite`) |

All data stays in the `data/` folder: the database and the WhatsApp login. Back it up. To reset the WhatsApp link, press **Unlink** on the WhatsApp page.

If the admin page is reachable from the internet, put it behind HTTPS (for example Caddy or Nginx) and use a strong `ADMIN_PASSWORD`.
