# Why Your Emails Go to Spam, and How to Fix It (Non-Tech Guide)

## What I found (checked 27 Nov 2026)

I looked up the email settings ("DNS records") for **eeatminds.in**. They're managed at **Wix**.

| Record | What it does | eeatminds.in |
|---|---|---|
| **MX** | Lets you *receive* email at @eeatminds.in | ❌ Missing. Your domain can't receive email at all |
| **SPF** | Tells Gmail/Outlook which servers may send as you | ❌ Missing |
| **DKIM** | A digital signature that proves an email really came from you | ❌ Missing |
| **DMARC** | Tells inboxes what to do with fake emails using your name. Gmail and Yahoo now require it for bulk senders | ❌ Missing |

**In plain words:** Gmail and Outlook can't verify that you are who you say you are, so they play it safe and put you in spam. And if you're sending from a free @gmail.com address, sending many similar emails to strangers is exactly the pattern Google's filters watch for. It also looks less professional to a principal than `shreyas@eeatminds.in`.

Other common spam triggers:
- images, attachments or links in the **first** email to a stranger
- open tracking and click tracking (they add hidden pixels and redirect links)
- sending 50+ emails in one go from a new mailbox
- emails that bounce because the address doesn't exist

---

## Should you use Brevo? **Not for this campaign**

Brevo is a good tool, but its rules **forbid importing purchased, rented, scraped or third-party email lists**. Contacts must have opted in. Emails you get from FullEnrich count as third-party, and Brevo can suspend the account immediately ([Brevo anti-spam policy](https://www.brevo.com/legal/antispampolicy/), [Brevo help: forbidden lists](https://help.brevo.com/hc/en-us/articles/209405205-What-is-the-anti-spam-policy-of-Brevo)). Mailchimp and most newsletter tools have the same rule.

**Use Brevo later** for a newsletter (for example "Admission Season Tips for Schools") sent **only to people who said yes**: schools that replied, past clients, people who sign up on eeatminds.in. Its free plan allows 300 emails/day ([Brevo free plan limits](https://help.brevo.com/hc/en-us/articles/208580669)).

## What to use instead

| Tool | Cost | Good for cold email? | Use it for |
|---|---|---|---|
| **Google Workspace** on eeatminds.in | about ₹270/user/month + GST on the annual plan ([Google India](https://workspace.google.com/intl/en_in/products/gmail/for-work/)); check the price at signup | ✅ This is your mailbox | A professional address: `shreyas@eeatminds.in` |
| **Apollo** (you already have a free account) | ₹0 | ✅ Built for this | Automatic follow-ups that stop when someone replies, plus mailbox warm-up. Reviews say the free plan allows 2 sequences and 1 mailbox; check your account |
| **Mailmeteor** (Gmail add-on) | Free for 50 emails/day | ✅ | The simplest option if Apollo feels complicated: Google Sheet + Gmail |
| **Instantly / Smartlead** | about $37–39/month (check) | ✅ | **Later**, after your first client, when you want 100+ emails/day across several mailboxes |

**Recommended for you right now:** Google Workspace on eeatminds.in + Apollo free. Total about ₹320/month.

---

## Step-by-step setup (about 1 hour, plus waiting time)

### Step 1: Create your business mailbox (15 min)

1. Go to **workspace.google.com** → **Get started**.
2. Business name: EEAT Minds. Number of employees: Just you.
3. When asked about a domain, choose **"Yes, I have one I can use"** → type `eeatminds.in`.
4. Create your username: `shreyas` → you'll get **shreyas@eeatminds.in**.
5. Pick **Business Starter** and pay.
6. Google will ask you to **verify your domain**. It shows you a TXT record to copy. Keep that tab open and go to Step 2.

### Step 2: Add the records in Wix (20 min)

1. Log in to **Wix** → go to your site dashboard → **Settings** → **Domains**.
2. Next to `eeatminds.in`, click the **⋯ (three dots)** → **Manage DNS records**.
3. Add each record below. Click **+ Add record** in the right section (TXT or MX), paste, then **Save**.

**a) Google verification** (from Step 1)
- Type: **TXT** · Host name: *leave empty* (or `@`) · Value: *the text Google gave you*
- Go back to Google and click **Verify**. It can take a few minutes to an hour.

**b) MX: so you can receive email**
- In the **MX** section click **Edit MX records**. If Wix lists **Google Workspace** as a provider, pick it. Otherwise choose *Other* and enter:
- Host name: *empty / @* · Points to: `smtp.google.com` · Priority: `1`
- Delete any other MX records in that section.

**c) SPF: who may send as you**
- Type: **TXT** · Host name: *empty / @*
- Value: `v=spf1 include:_spf.google.com ~all`
- ⚠️ There must be **only one** record starting with `v=spf1`.

**d) DKIM: your digital signature** (do this 24 hours after Step 1, once Gmail is active)
1. Open **admin.google.com** → menu ☰ → **Apps** → **Google Workspace** → **Gmail** → **Authenticate email**.
2. Select `eeatminds.in` → **Generate new record** → key length **2048** → **Generate**.
3. Copy the two values Google shows into Wix:
   - Type: **TXT** · Host name: `google._domainkey` · Value: *the long text starting with* `v=DKIM1;`
   - If Wix rejects the long value, go back, choose key length **1024**, and try again.
4. Wait about 1 hour, go back to Google Admin and click **Start authentication**.

**e) DMARC: required by Gmail and Yahoo for bulk senders**
- Type: **TXT** · Host name: `_dmarc`
- Value: `v=DMARC1; p=none; rua=mailto:shreyas@eeatminds.in`
- After 4–6 weeks with no problems, change `p=none` to `p=quarantine`.
- Tip: in Gmail, make a filter that sends emails with "Report domain:" in the subject to a "DMARC" label, so the reports don't clutter your inbox.

### Step 3: Check it works (5 min)

1. Go to **toolbox.googleapps.com/apps/checkmx** → enter `eeatminds.in` → everything should be green.
2. Go to **mail-tester.com** → it shows you an email address → send a normal email to it from `shreyas@eeatminds.in` → click **Then check your score**. **Aim for 9/10 or higher.** It tells you exactly what's wrong if you score lower.

### Step 4: Make the mailbox look human (10 min)

- **Profile photo** in your Google account. Your face shows up in Gmail, which helps people trust the email.
- **Signature, text only** (no logo images, no badge images, no social icons):
  ```
  Shreyas V Patil
  Founder, EEAT Minds (Google & Meta certified)
  Bangalore | +91 [your number] | eeatminds.in
  ```

### Step 5: Warm up the mailbox (14 days, 10 min/day)

A brand-new mailbox that suddenly emails 30 strangers looks like a spammer. Build trust first:

- **Days 1–7:** send 5–10 normal emails a day to people who will reply (existing clients, friends, your other email addresses). Ask them to reply. Replies are the strongest trust signal.
- **Days 8–14:** 10–20 emails a day.
- **Apollo warm-up:** Apollo → **Settings** → **Mailboxes** → **Link mailbox** → choose Google → sign in with `shreyas@eeatminds.in`. Then turn on **Warmup** with min 10 / max 40 per day. On free plans this uses Apollo credits ([Apollo help](https://knowledge.apollo.io/hc/en-us/articles/26772718460045-Use-Email-Warmup-to-Improve-Email-Deliverability)).
- **During warm-up you CAN still reach your HOT leads.** Write 3–5 personal emails a day by hand (Stonehill, NPS, new schools). One-to-one emails written for one person are normal business email. And start **LinkedIn today**: it needs no setup.

### Step 6: Get the email addresses with FullEnrich (15 min)

1. **fullenrich.com** → **New enrichment** → **Upload CSV** → choose `prospects.csv`.
2. Map the columns: First Name, Last Name, School → Company, Domain → Company domain, LinkedIn URL → LinkedIn.
3. Ask for **work email only**. Phone numbers cost more credits; get them only for the 1-HOT rows.
4. Download the result. **Use only emails marked valid/deliverable.** Put "catch-all" or "risky" ones aside for LinkedIn instead. Bounces hurt your mailbox reputation.
5. Skip rows marked **HOLD** or **LinkedIn only**.

### Step 7: Build the sequence in Apollo (20 min)

1. **Contacts** → **Import** → upload the FullEnrich file → map the fields. Make custom fields for `school` and `area` so `{{school}}` and `{{area}}` work.
2. **Engage / Sequences** → **Create sequence** → *From scratch* → name it "Schools – Bangalore".
3. Add 4 steps using the text in `email-sequences.md`:
   - Day 1: **Automatic email** (Email 1)
   - Day 3: **Automatic email, reply in same thread** (Email 2, with the inline image)
   - Day 6: **Automatic email, reply in same thread** (Email 3)
   - Day 10: **Automatic email, reply in same thread** (Email 4)
4. **Sequence settings:**
   - Schedule: **Mon–Fri, 9:30 am – 5:00 pm IST** (school office hours)
   - Mailbox daily limit: **25**. Apollo itself recommends staying at or under 50 ([Apollo sending limits](https://knowledge.apollo.io/hc/en-us/articles/4409233349005))
   - **Turn OFF open tracking and link tracking** for this sequence
   - "Mark as finished when contact replies": **ON**
5. Add 20–25 contacts per day, not all 49 at once.

---

## Sending rules (print these)

1. **Email 1: plain text. No images, no links, no attachments.**
2. **One small inline image, only in Email 2.** Never attach files to cold emails.
3. **25 emails/day per mailbox, maximum.** To send more, add a second mailbox; don't raise the limit.
4. **Avoid spam words:** *guaranteed, 100%, free!!!, act now, #1 ranking guaranteed, $$$*, and ALL CAPS.
5. **Always include the opt-out line:** "If this isn't relevant, just reply 'no' and I won't email again." Honour it the same day.
6. **Reply to every reply within a few hours.** Speed wins school deals.
7. **Never buy email lists.**
8. **Check your spam placement every Monday:** send Email 1 to a friend's Gmail and an Outlook address and see where it lands.

## When you're ready to scale (after your first client)

- Buy 1–2 **look-alike domains** (for example `eeatmindsseo.in`), about ₹500–1,000/year each. Point them to eeatminds.in, add a mailbox to each, and send the bulk sequences from those. If one gets flagged, your main domain stays safe for client email.
- Move the sequences to **Instantly** or **Smartlead** for unlimited warm-up across many mailboxes.
- Optional: protect against fakes by changing DMARC to `p=quarantine`, and later `p=reject`.

## Your 30-minute daily routine

| Time | Task |
|---|---|
| 5 min | Check replies → answer using the reply table in `email-sequences.md` |
| 10 min | 15–20 LinkedIn connection requests and DMs to people who accepted |
| 10 min | Record 1–2 audit videos for anyone who said "yes" |
| 5 min | Update the **Status** column in `prospects.csv` (Emailed → Replied → Audit sent → Call → Proposal → Won/Lost) |
