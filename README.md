# Care Companion

A free, private app for people going through cancer treatment and the people who help them. It was first built for someone with multiple myeloma.

- **Medication reminders** on your phone, including blister packs, every-other-day and weekly schedules, and as-needed doses with safety limits
- **One-tap logging** for pain, symptoms (with a timer), temperature and fever alerts, bowel movements, water and exercise
- **A daily check-in** for tiredness, numbness, sleep, appetite, mood and warning signs
- **Appointments** with a month calendar that syncs to your phone's Calendar app
- **Circle of care**: every doctor and nurse, with one-tap call buttons
- **A report for the doctor**: charts, a day-by-day log and a one-page visit summary to print or share
- **Shared between phones**: the patient and caregivers see the same information and can all get reminders

It runs on **your own free Cloudflare account**. Your health information is stored only there, never on anyone else's server. No app store is needed: it works from Safari on iPhone and from Chrome on Android.

> **Care Companion is a reminder and tracking helper, not medical advice.** Always follow your care team's instructions. In an emergency, call your local emergency number.

---

## Set it up (about 10 minutes, no technical skills needed)

You need an email address. You'll create two free accounts along the way.

### 1. Click the button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/vnichol/care-companion)

### 2. Sign in or create the free accounts

- **Cloudflare** hosts the app. Choose the **Free** plan. No credit card is needed.
- **GitHub** keeps your own copy of the app's code. When Cloudflare asks to connect to GitHub, sign in or create a free account, then click **Authorize**.

### 3. Click "Create and deploy"

You can keep all the suggested names. Cloudflare then sets everything up by itself (the server, the database and the reminder timer), which takes 1–3 minutes.

When it's done, you'll see a web address like `https://care-companion.your-name.workers.dev`. **That's your Care app.** Keep this address.

### 4. Open the address and finish setup

**Do this right away.** The first person to open a new copy sets it up.

1. Open the address in **Safari** on the iPhone (or Chrome on Android).
2. Fill in:
   - who Care is for
   - your name
   - °C or °F
3. Care makes a **family code** for you. **Write it down.** Anyone who uses Care types it once on their phone.
4. Tap **Finish setup**.

### 5. Put it on the Home Screen and turn on reminders

1. In Safari, tap **Share** (the square with an arrow), then **Add to Home Screen**.
2. Open Care from the new icon and type the family code.
3. Go to **Settings → Turn on reminders**, then tap **Send a test**.

On iPhone, reminders only work when Care is opened from the Home Screen icon.

### 6. Add other phones

On a caregiver's phone, open the same web address, **Add to Home Screen**, and type the family code. To find the code again, go to **Settings → Family code → Show** on a phone that's already signed in.

The app has a full help page under **Settings → Help**.

---

## Adding medications from a spreadsheet

If your pharmacy or clinic gives you a list, you can import it with **Meds → Import from a CSV file**. See [`medications-example.csv`](medications-example.csv) for the columns. Care shows a preview before anything is saved.

Blister slot codes:
- **BK**: Breakfast
- **LU**: Lunch
- **SP**: Supper
- **BD** or **HS**: Bedtime

---

## Cost

Cloudflare's free plan is plenty for one family. Care uses a small part of the daily free allowance, and your information takes up only a few megabytes a year. You won't be charged unless you choose to upgrade.

## Privacy

- Your information is stored in a private database on **your** Cloudflare account. The author of this app can't see it.
- The family code is stored only in scrambled (hashed) form.
- Anyone with the family code can see and change the information, so share it only with people who are helping.

## Forgot the family code?

If any phone is still signed in, go to **Settings → Family code → Show**.

If no phone is signed in, you can choose a new code without losing any information:

1. Sign in to [dash.cloudflare.com](https://dash.cloudflare.com) and go to **Storage & Databases → D1 → care-db → Console**.
2. Run: `DELETE FROM settings WHERE key = 'code_hash';`
3. Open your Care address. The setup screen appears, and you can choose a new code. Everything else is kept.

## Getting updates

Your copy doesn't update by itself. To get a newer version:

1. Open your copy on GitHub.
2. Replace the files with the latest version from this project, or use **Sync fork** if your copy is a fork.

Cloudflare rebuilds the app automatically, and the database updates itself.

---

## For developers

The app has no build step and no runtime dependencies:
- `src/`: the Cloudflare Worker (API, Web Push and iCal feed)
- `public/`: the app, written in vanilla JavaScript
- `migrations/`: the D1 database tables

```bash
npm install
npm run dev      # local copy at http://localhost:8787
npm test         # push encryption tests
npm run deploy   # applies database migrations, then deploys
```

To change the database, add a new numbered file to `migrations/`. It's applied automatically on the next deploy.

## License

MIT. See [LICENSE](LICENSE).
