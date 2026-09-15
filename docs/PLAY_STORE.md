# Yaar — Google Play submission guide

Everything needed to turn this repository into a published Android app. Written for whichever
developer or agent picks this up next: follow the steps in order.

---

## 1. Store listing copy

**App name** (30 chars max): `Yaar — AI Companion`

**Short description** (80 chars max):

> Someone to talk to, anytime. Chat with a warm AI companion in Urdu, Hindi or English.

**Full description** (4000 chars max):

> **Someone to talk to, anytime.**
>
> Yaar is an AI companion for the moments when you feel bored, lonely, or just want someone to
> talk to. Pick your Yaar, say hello, and have a real conversation — the kind that asks how your
> day went and actually listens.
>
> **Two companions to choose from**
> • Your Girlfriend — warm, caring and a little playful. She asks about your day, teases you
>   gently, cheers for your wins and notices when something is off.
> • Your Boyfriend — friendly, supportive and easy to talk to. He jokes around, hypes you up, and
>   is never awkward about listening.
>
> **Talk in your own language**
> Write in English, اردو, हिन्दी, or Roman Urdu/Hindi — Yaar replies in the same language, and
> follows you if you switch mid-conversation. No language settings, no menus.
>
> **It feels like texting**
> Short natural messages, real questions back, and replies that appear as they are typed. Your
> conversation is saved so you can always pick up where you left off.
>
> **Free, simple and private**
> • 20 messages every 24 hours, free.
> • No account, no email, no phone number.
> • Your chats are yours — delete them any time in Settings.
>
> **Good to know**
> Yaar is an AI companion, not a human being. It is here to listen and keep you company, but it
> cannot replace professional help. If you are in crisis, please contact your local emergency
> number or a helpline.
>
> Made with care. 💛

**Category:** Social (alternative: Lifestyle)
**Tags:** AI companion, chat, companionship, Urdu, Hindi
**Contact email / website:** your support email and a hosted privacy-policy URL (host the `/privacy`
page).

---

## 2. Screenshots and graphics

Capture from a real device or emulator (the app is a PWA, so a browser at 412×915 with device
toolbar hidden also works):

| Asset | Size | Suggested content |
| --- | --- | --- |
| Phone screenshots (min 2, max 8) | 1080×1920 | Home with both cards · girlfriend chat with a warm exchange · boyfriend chat · Urdu conversation · limit card · Settings |
| Feature graphic | 1024×500 | Wordmark on the pink gradient + tagline |
| App icon | 512×512 | `client/public/icons/icon-512.png` (already generated) |
| Play Store icon | 512×512 | `client/public/icons/icon-1024.png` resized |

Regenerate the icon set after any artwork change:

```bash
npm i --no-save sharp
npm run icons
```

---

## 3. Android packaging (Capacitor)

```bash
# 0. make sure the client can reach the API from the WebView
echo 'VITE_API_BASE_URL=https://your-api.example.com' >> .env
npm run build

# 1. add Capacitor
npm i -D @capacitor/cli@^6
npm i @capacitor/core@^6 @capacitor/android@^6
npm i @capacitor/keyboard@^6 @capacitor/splash-screen@^6 @capacitor/status-bar@^6

# 2. add the platform (config comes from capacitor.config.json)
npx cap add android
npx cap sync android

# 3. after every web change
npm run build && npx cap sync android

# 4. open Android Studio
npx cap open android
```

### Android specifics to check

* `android/app/build.gradle`: set `applicationId "com.yaar.companion"`, bump `versionCode`
  (integer, +1 per upload) and `versionName` (e.g. `1.0.0`).
* `minSdkVersion`: 23 or higher recommended (WebView version matters for `dvh`/`svh` units).
* Icons: replace `mipmap-*/ic_launcher*.png` with the generated icons; `ic_launcher_foreground`
  wants the maskable variant (`client/public/icons/icon-maskable-512.png`).
* Splash: `android/app/src/main/res/drawable/splash.png` (matching `#fff5f9` background, already set
  in `capacitor.config.json`).
* Keyboard: `Keyboard.resize: "body"` is configured so the composer stays above the soft keyboard.
* Permissions: the base app needs **only** `android.permission.INTERNET`. Do not add location,
  contacts, camera or storage permissions — the data-safety form and review are easier, and the app
  genuinely does not need them.
* Back button: the WebView maps it to browser history, which matches the app's routing. Consider
  `@capacitor/app`'s `backButton` handler later if you want "exit from home".

### Building a signed release

```bash
# 1. create an upload keystore (keep it safe — losing it means losing update ability)
keytool -genkey -v -keystore yaar-upload.jks -alias yaar \
  -keyalg RSA -keysize 2048 -validity 10000

# 2. point Gradle at it (do NOT commit the keystore or passwords)
#    android/keystore.properties   →  is git-ignored by .gitignore
storeFile=../yaar-upload.jks
storePassword=…
keyAlias=yaar
keyPassword=…

# 3. build the bundle Play wants
cd android && ./gradlew bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
```

Then create the app in the Play Console, upload the `.aab` to **Internal testing** first, install
via the test link, and run through the flows in §6 before promoting to production.

---

## 4. Data safety form answers

The form must match what the code actually does (see `server/db/schema.sql` and the `/privacy`
page):

| Question | Answer |
| --- | --- |
| Does the app collect or share user data? | **Yes** (messages are processed to generate replies) |
| Data types collected | **Messages** (in-app content the user types); **Device or other IDs** (an anonymous device identifier used to keep a stable session and enforce the daily limit) |
| Is the data shared with third parties? | **Yes** — messages are sent to the AI provider (Hugging Face) to generate replies |
| Is the data encrypted in transit? | **Yes** (HTTPS in production) |
| Can users request deletion? | **Yes** — in-app “Delete all my data” plus the support email |
| Personal info (name/email/phone) | **Not collected** — the app has no accounts |
| Location, contacts, photos, files, health, financial info | **Not collected** |
| Advertising / tracking IDs | **Not collected** |
| Data used for advertising | **No** |
| Account creation required? | **No** |

---

## 5. Content rating & policy notes

* **Content rating questionnaire:** the app contains user-generated content sent to an AI, and AI
  content that may be unpredictable. Do not claim "no user interaction". Declare that the app has an
  **in-app chat with an AI**, and mark **"Shares info with third parties"**. Romance/affection is
  implied by the companion framing, so select the rating band that matches your region's
  requirements (typically Teen / 12+ / 16+ depending on store policy) rather than Everyone.
* **AI-generated content policy:** Play requires that generative-AI apps prevent prohibited content
  and provide an **in-app way to report** content. Before publishing, add:
  1. a “Report this reply” action on assistant messages (post to `/api/reports`, store the message
     id + reason), and
  2. a short in-app note that replies are AI-generated (already present on Home/About/Settings).
* **Minimum age:** the app targets 13+ (see `/privacy`). Set the target audience accordingly and do
  not opt into the Families programme.
* **Crisis disclosure:** the About and Terms screens state clearly that Yaar is not a crisis
  service and point users to real help. Keep that text intact — it is part of the safety design.
* **Privacy policy URL:** host the app's `/privacy` text on a public HTTPS URL and enter it in the
  Console (required for all apps that handle user data).

---

## 6. Pre-submission QA checklist

Run these on a **signed release build** on a real device, plus once on a 360 px-wide device:

* [ ] `npm run verify` passes on the release commit (tests + build + smoke test).
* [ ] Fresh install → Home shows the brand, tagline, usage meter and both companion cards.
* [ ] Girlfriend and boyfriend chats each open, greet, and keep separate histories.
* [ ] English, Urdu, Hindi and Roman Urdu messages all get same-language replies.
* [ ] A long paragraph, a very long single word, and a mixed-language message all wrap correctly —
      no mid-word breaks, no horizontal page scrolling.
* [ ] The soft keyboard never covers the composer; the send button stays reachable.
* [ ] Sending 20 messages works; the 21st shows the friendly limit card with a live countdown.
* [ ] The counter survives: force-close the app, reopen, still 20/20.
* [ ] After 24 hours (or after `/api/chat/dev/reset-usage` in a dev build) sending works again.
* [ ] Airplane mode → friendly offline message, no crash, message kept for retry.
* [ ] Kill the API → “I couldn't reply just now” banner, then retry succeeds and consumes one
      message only.
* [ ] Settings → Clear conversation asks for confirmation and empties the chat.
* [ ] Settings → Delete all my data asks for confirmation and removes everything.
* [ ] Back button navigates sensibly from chat → home → exit.
* [ ] Dark mode and large-font accessibility settings keep the UI readable.
* [ ] No console errors, no ANR, cold start under ~2 s on a mid-range device.

---

## 7. Release checklist (short form)

1. `git status` clean, `npm run verify` green.
2. `VITE_API_BASE_URL` points at the production API; `npm run build`.
3. Bump `version` in `package.json` and `versionCode`/`versionName` in Gradle.
4. Tag the release: `git tag -a v1.0.0 -m "Yaar v1.0.0"` + `git push --tags`.
5. `cd android && ./gradlew bundleRelease` → upload the `.aab`.
6. Complete data safety, content rating, store listing and privacy URL.
7. Internal testing track → QA checklist above → staged rollout (10 % → 50 % → 100 %).
