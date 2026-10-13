# Proof of Duty (POD) · V0.1

**Shoot • Survive • Win.** Developed by **Tcee** 🇳🇬, built from scratch by one Nigerian developer.

A tactical online first-person shooter played across all 36 states of Nigeria and the FCT. The game text is in Nigerian Pidgin English. You choose a state and choose what you are (Police, Army, Civil Defence or Vigilante Hunters against Bandits, Creek Militants or Smugglers). Then you fight real players for that state's real natural resources.

It runs in the browser (desktop and mobile) and uses Three.js for 3D. The server is authoritative and written in Node, with WebSockets for live play.

---

## Quick start

```bash
npm install
npm run dev          # game on http://localhost:5173, server on :2567
```

Open the game in two browser windows to see real players in the same battle.

To run it in production:

```bash
npm run build        # bundles the client into dist/
ADMIN_KEY=your-secret npm start    # serves the game, the WebSocket and /admin on one port
```

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `2567` | HTTP and WebSocket port |
| `ADMIN_KEY` | `change-me` | Password for the advertiser dashboard. **Set this before going live.** |
| `DATA_DIR` | `./data` | Local JSON files, used only when Supabase is not set |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | not set | Keep all data and advert images in Supabase (see the ad portal section) |
| `PAYSTACK_SECRET_KEY` | not set | Turns on payments in the ad portal |
| `PUBLIC_URL` | request host | Address Paystack sends advertisers back to |
| `VITE_SERVER_URL` | same host | Set at build time if the game server lives on another domain (e.g. `wss://api.example.com/ws`) |

To run the simulation tests, use `npm test`. It plays bot battles in every state and checks hits, revives, gems, respawns, explosives, artillery and ad analytics. Two suites run: 94 game checks (including Team Deathmatch, Plant & Defuse and Campaign Stages), and 56 ad portal checks. The portal checks run the real server against stand-in Paystack and Supabase servers: book, pay, webhook, approve, reject with refund, and restart, plus player chat with businesses, blocking and daily rewards.

---

## Game modes

| Mode | What you do |
| --- | --- |
| **Hold Ground** | The original mode: capture and hold the state's three resource sites. First side to 750 points wins. |
| **Gbas Gbos** | Team deathmatch. First to 60 kills, or the side with the most kills after 10 minutes, wins. |
| **Plant & Defuse** | Rounds with one life each. Outlaws carry a bomb to site A or B and plant it (hold E, 3.5 s). Security stops them or defuses it (hold E, 7 s). First to 5 rounds wins. There's an 8 s buy time at the start of each round, round money, a dropped bomb anyone on that side can pick up, and bots that plant and defuse. |
| **Campaign Stages** | A solo story of 12 stages across Nigeria, from *Wahala for Marina* (Lagos) to *Aso Rock Final Stand* (FCT). You and 2 bot allies clear waves of enemies with limited lives. You earn up to 3 stars per stage, and the first clear of each stage pays 1 gem. Each clear unlocks the next stage. |

Press **V** (or the chat button on phones) for Pidgin quick chat.

## Staying alive

- **Health regeneration:** health comes back on its own after 5 seconds out of fire.
- **Bots hit softer:** bots hit human players for 70% damage, no single bot bullet can do more than 38 (so no one-shot headshots from bots), and bots aim at players' heads less often.
- **Second wind:** once per life, a bot's killing blow leaves you on 20 health with a moment of protection to find cover.
- **Starting kit:** everyone lands with light armour (40) and one **blood pill** (N, or 💊 on phones). A pill heals 35 over 2.5 s and you can keep moving. You can buy up to 3.
- **Gemstones** sit on every ground advert tile and come back 40 s after someone takes one:
  - **Ruby:** +30 health
  - **Emerald:** +60 health
  - **Sapphire:** +50 armour
  - **Golden Topaz:** full health and +25 armour (rare)

## Close combat and two guns

- **Punch (F, or 👊):** works any time, with any weapon in hand. Three punches in a row on the same enemy land a heavy blow. The machete is still on 3, with backstabs. Bots fight hand to hand when you get in their face.
- **Two guns, one per hand:**
  - **Dual P9:** unlocks at rank level 3.
  - **Dual MP5:** unlocks at rank level 6.
  - Buy them in the armoury once unlocked. The two guns fire left-right in turn.

## Real players

- **Bots are optional:** in Settings, turn off "Fight with bots" to play in rooms with real players only. Campaign stages keep their enemies.
- **👥 Squad:**
  - **Friends:** add people by friend code, see who is online and in which battle, and press **Join** to land in the same battle.
  - **Crews:** your crew tag shows before your name in battle, for example `[LGL] Ada`.
  - **Rivals:** the real players you keep trading kills with. Your top rival gets a ⚔ RIVAL mark when you can see them, and killing them back earns REVENGE XP.

## The world

- **Rivers** with bridges in the savanna, rainforest, plateau and Sahel. Creeks and the Lagos canal keep their channels.
- **An old rail yard** on every map, with abandoned boxcars, a tanker, a flatcar and a locomotive to use as cover.
- **A live railway on a viaduct** outside the wall, where trains thunder past on a timetable every player shares.
- **Warehouses** with big loading doors and containers inside.
- **Abandoned, burnt-out houses** with jagged shot-up walls, rubble and graffiti.

## Camera views

- **Choose your view** in Settings: **Hands only** (first person, the default) or **Full body** (third person). Switch any time in battle with H, or 🎥 on phones.
- **Full body:** third person over your shoulder, and you still fight normally. Shots leave from your soldier's eyes toward whatever is under the crosshair, so aim and the server's hit checks stay honest. Sniper scopes switch to first person while you aim. The camera moves in when there is a wall behind you.
- **Scout drone (T, or 🛸):**
  - You fly a camera drone over the battlefield, with a cockpit display: recording light, altitude, heading, distance from your body, and battery.
  - Controls: WASD or the stick to fly, Shift for speed, Space/C (▲/▼ on phones) or the mouse wheel to change height.
  - Your soldier stays where you left them and can be shot. Taking damage cuts the drone signal.
  - The battery lasts 30 s and then recharges. It is unlimited while your side's recon drone killstreak is up, and while you are dead and waiting to come back (the death screen has a **Fly drone** option).

## Talk to the businesses on the billboards

1. Aim your crosshair (or the drone reticle) at any paid advert. A **💬 Chat with …** button appears. Press **J** or tap it.
2. While you chat you are protected: nobody can hurt you, bots ignore you, and you can't shoot. Walking away or 2 minutes passing ends the chat. You can't start one right after being shot or while carrying the bomb. In a solo campaign stage the battle pauses.
3. The business reads and replies in the ad portal (**/advertise → Messages**). The reply arrives live in your game, and the **📨 Inbox** (lobby and pause menu) keeps every conversation.
4. Privacy: players see only the business name; businesses see only the soldier name. A business can block a player. Messages are limited in length and how fast you can send them.

## Daily duty

- **🎁 Daily login calendar:** 7 days of rewards: gems, XP, and 5 gems on day 7. Miss a day and the streak starts again.
- **Three daily missions** that change every day (Nigerian time), for example: kill 10 enemies, land 3 headshots, pick up 2 life gems, win a battle, revive 2 teammates, or capture 2 sites. You get a toast when one is done; collect the reward in 🎁 Daily.

## How a battle works

- **37 battlefields.** Each state builds its own map from a fixed seed, so every player sees the same layout. Each map has:
  - the state's terrain (Sahel, savanna, plateau, rainforest, creeks or coastal city)
  - three resource sites based on what the state really produces (oil wellheads, gas flow stations, gold pits, tin mines, cocoa, cattle ranches and more)
  - its landmark, such as Zuma Rock, Olumo Rock, Aso Rock, the Kano city gate, the Bonny gas flare, Shere Hills or the Marina skyline
- **Factions.** Each one has a perk and a cheaper signature weapon:

  | Faction | Perk |
  | --- | --- |
  | Police | Start with a vest |
  | Army | Artillery after 4 kills |
  | Civil Defence | Capture sites 40% faster |
  | Vigilantes | Silent footsteps; the Dane gun is free |
  | Bandits | +10% speed |
  | Creek Militants | Cheap explosives; fast in water |
  | Smugglers | +30% income |

- **Bots** fill each side up to 5 fighters, so every state is always at war. When real players join, bots leave to make room.
- **Scoring.** Holding sites A, B and C earns points and money every second. Every few minutes a **new deposit is discovered** somewhere on the map, marked with a gold beam, and it is worth double. A match ends at 750 points or after 15 minutes, then a new round starts.
- **Weapons and gear.**
  - Guns: P9 pistol, Hawk .50, MP5, AK-47, G3, Dane gun (shotgun), PKM, SVD sniper and RPG-7.
  - Gear and grenades: frag, smoke and flash grenades, vests and helmets, and first aid kits.
  - Killstreaks: a recon drone at 3 kills and an artillery barrage at 5 kills, with a shell whistle warning.
- **Realism.**
  - Movement:
    - Jog, sprint with stamina, crouch, quiet walk and jump.
    - Water slows you down.
  - Shooting:
    - Recoil and spread grow when you move or spray.
    - Rounds can penetrate thin mud, zinc and plank walls.
    - The server rewinds time to judge hits fairly for laggy players.
    - Headshots do extra damage, and armour reduces body damage.

### Coming back from death (the "something special")

You are **downed** first. A teammate has 10 seconds to revive you by holding E. If you die, you choose one of three ways back:

1. **Life gem 💎.** Spend one gem and redeploy instantly. You start with 3 gems, earn more when you rank up, and collect them from advert walls.
2. **Spirit run 👻.** You become an invisible spirit for 40 seconds. Reach any glowing gem on an advert wall and you come back for free, but that gem is used up for everyone.
3. **Medevac 🚁.** Wait 25 seconds and pay ₦1,000.

If you leave the death screen alone, the medevac comes automatically after 60 seconds.

All the numbers are in `shared/config.js` (`RESPAWN`, `GEMS`), so you can retune them or swap in a different idea. A state trivia question or a short mini-mission would slot into `onRespawn` in `server/match.js`.

### Life gems on advert walls

Every advert wall carries a glowing gem. Walking into it gives you +1 life gem and +25 health. Once anyone collects it, that wall's gem is gone **for everybody for 2 minutes**. A ring under the gem shows the countdown until it resurfaces.

---

### Fuel drums

Red steel drums stencilled **PMS / FLAMMABLE** hold fuel; blue plastic drums hold water.

- Shoot a fuel drum (or catch it in a grenade, rocket or artillery blast) and it explodes.
- Anyone close is hurt or killed depending on distance, teammates included. People within a few metres also **catch fire** and keep burning for a few seconds; jumping into water puts the flames out.
- Fuel drums next to each other set each other off in a chain.
- The wreck keeps burning for a while. All drums are back at the start of the next round.
- Water drums only ring when shot.

Tune it in `shared/config.js` → `DRUMS`.

## Selling billboards: the ad portal

Advertisers book and pay by themselves at **`/advertise`**. You only approve the artwork.

**Billboards in every state** (each one has a code such as `LAG-S2`):

| Type | Where | Artwork | Default price / day |
| --- | --- | --- | --- |
| **Sky Billboard** (4 per state) | 28 m billboards on skyline towers or highway unipoles just outside the walls, seen from most of the map | 16:9, at least 1920×1080 | ₦25,000 |
| **LED Road Screen** (2 per state) | Double-sided screens on poles in the middle of the fighting | 16:9, at least 1280×720 | ₦12,000 |
| **Ground Tile** (up to 3 per state) | Giant floor artworks (up to 16 × 9 m) set into open ground. Made for the drone, spectators and rooftops. No collision, so they never change the fight. | 16:9, at least 1920×1080 | ₦15,000 |
| **Wall Banner** (about 12 per state) | The lit walls that hold life gems | 2:1, at least 1200×600 | ₦5,000 |

**Price** = daily price × state tier × days.
- State tiers: Premium ×1.5 for Lagos, FCT and Rivers. Major ×1.25 for Kano, Oyo, Kaduna, Enugu, Delta, Anambra, Edo, Ogun and Akwa Ibom.
- Discounts: 10% off 7+ days and 20% off 30+ days.
- Each billboard rotates up to 4 advertisers, switching every 12 s. **Exclusive** (no rotation) costs ×3.

You can change every price in `/admin`.

**How a booking works:**
1. The advertiser signs up, picks a state and a billboard on the map, and uploads artwork. The portal checks the shape and HD size and can crop it to fit. They then choose a start date and number of days.
2. They pay with **Paystack** (card, transfer or USSD). The server confirms the payment with Paystack itself, through both the return page and the webhook. Paystack signatures are checked, and the amount and currency must match.
3. The booking appears in `/admin` under **waiting for your review**:
   - **Approve** puts it live for exactly the days paid, starting on its start date or now if that is later. It stops by itself when the time is up.
   - **Reject** refunds the advertiser in full through Paystack and shows them your reason.
4. The advertiser follows views, unique players and the Security/Outlaw split per day in **My campaigns**. They can renew with one tap.

**Other details:**
- **No double-selling.** A billboard can't be booked over capacity, or exclusively when someone else already shares those dates.
- **Unpaid bookings.** An unpaid booking holds its slot for 2 hours, then releases it.
- **HD in the game.** Paid artwork loads at full resolution with mipmaps and maximum anisotropic filtering. It is drawn unlit, so colours match the artwork exactly, and only lightly hazed by fog. Unsold billboards show a "YOUR BRAND FIT DEY HERE · /advertise" invitation.
- **Rotation clock.** All players see the same advert at the same moment, and every view is credited to the advert on screen at that time.

`/admin` (sign in with `ADMIN_KEY`) also has:
- house/direct campaigns for deals you make yourself
- reports by state, side, faction and hour
- CSV export
- the advertiser list and password resets
- a status line that tells you if Paystack or Supabase is not set up

**Privacy.** Advertisers only see aggregated numbers. Unique players are counted with salted hashes, and no names, accounts or locations are ever exposed. Have a lawyer confirm the details for Nigeria's data protection rules (NDPA) before you sell.

### One-time setup on Render

1. **Supabase** (free): this keeps accounts, profiles, bookings and images across restarts.
   1. Create a project at supabase.com.
   2. Open **SQL Editor**, paste [`supabase/setup.sql`](supabase/setup.sql) and click **Run**.
   3. Under **Project Settings → API**, copy the **Project URL** and a **secret key** (`sb_secret_…`, or the legacy `service_role` key).
2. **Paystack:** under **Settings → API Keys & Webhooks**:
   1. Copy your **secret key** (`sk_live_…`).
   2. Set the **Webhook URL** to `https://three6states.onrender.com/api/paystack/webhook`.
3. **Render → your service → Environment**: add these variables, then **Save** (Render redeploys):

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | your Project URL, e.g. `https://abcd.supabase.co` |
| `SUPABASE_SERVICE_KEY` | the Supabase secret key |
| `PAYSTACK_SECRET_KEY` | `sk_live_…` (or `sk_test_…` to try it first) |
| `PUBLIC_URL` | `https://three6states.onrender.com` |
| `ADMIN_KEY` | a long password only you know |

Keep the secret keys only in Render. Never put them in the code or send them in chat.

---

## Super admin panel (`/admin`)

Sign in at `https://three6states.onrender.com/admin` with `ADMIN_KEY`. Tabs:

| Tab | What you can do |
| --- | --- |
| 📊 Dashboard | players online now and today's peak, live battles, active players (today, 7 days, 30 days), new players, battles and kills today, accounts, bans, open reports, push devices, a 14-day chart, top modes, players by rank, server memory and uptime |
| 👤 Players | search by name or player ID, filter (online, banned, muted, accounts), sort, CSV export. Open a player to ban (for hours or forever), unban, mute chat, kick from battle, give or take gems/XP, rename (sticks even for guests), reset stats, delete, or message them (in game and on their phone) |
| ⚔ Live battles | every battle with real players: who is in it, kills and deaths, message the battle, kick a player, end the battle |
| 🛡 Moderation | player reports (with the reported player's recent chat), the live chat log, and every player ↔ business conversation |
| 🔔 Notifications | send a push notification to everyone, to players who have been away for N days, or to one player; a lobby announcement banner; an instant pop-up to everyone online; history of everything sent |
| ⚙ Game settings | maintenance mode (everyone goes back to the lobby, nobody can start a battle), events such as double XP or double money for N hours, "update your app" (minimum Android build and download link), and live game balance (health regen, bot damage, armour, pills, XP, gems, money) with reset to default |
| 🪧 Ads & billboards | everything from the ad portal section above |
| 👥 Team & audit | add team members with their own key: **moderator** (players, battles, chat, reports) or **marketing** (notifications, announcements, ads). Remove them at any time. The audit log records who did what |

Players see news under the 🔔 button in the lobby, the announcement and event strip above the modes, and pop-ups during battle. They can report a player from the pause menu (🚩 Report a player).

### Push notifications

Players switch them on or off in **Settings → Notifications**.

- **Website (Chrome, Edge, Firefox, Android browsers):** works straight away. The server makes its own keys; nothing to set up.
- **Android app:** uses Firebase Cloud Messaging. Until you do the steps below, the app is built without push (and the switch says it comes with the next update). One-time setup:
  1. Go to console.firebase.google.com → **Add project** (Analytics not needed).
  2. **Add app → Android**, package name `ng.tcee.proofofduty`. Download **google-services.json**.
  3. GitHub → your repo → **Settings → Secrets and variables → Actions → New repository secret**: name `GOOGLE_SERVICES_JSON`, value = the whole content of that file. The next APK has push.
  4. Firebase → **Project settings → Service accounts → Generate new private key**. On Render, add an environment variable `FIREBASE_SERVICE_ACCOUNT` with the whole content of that JSON file.
  5. Optional: `PUSH_CONTACT` = `mailto:you@example.com` (sent to push services as the contact).

Treat both Firebase files like passwords: keep them only in GitHub secrets and Render.

---

## Sound

All sound is **synthesised live** with Web Audio:

- **Guns:** each gun has its own crack, thump and echo tail.
- **Footsteps:** they change with the surface (sand, dirt, gravel, mud, concrete, wood, metal and water).
- **Explosions:** blasts come with debris.
- **Effects:**
  - artillery whistles
  - the drone buzz
  - the medevac helicopter
  - flashbang ringing
  - hit markers
  - the heartbeat at low health
- **Ambience:** each biome has its own wind, insects, birds, water, city traffic and rain. Gas flares roar and waterfalls rush.

Sounds play in 3D (HRTF). They are muffled with distance and arrive late at the speed of sound, so a distant shot's thump comes after its flash.

**To use real recordings,** put audio files in `client/public/sounds/` and list them in `client/public/sounds/manifest.json`:

```json
{
  "rifle": ["ak47-1.ogg", "ak47-2.ogg"],
  "pistol": ["p9.ogg"],
  "explosion": ["boom1.ogg", "boom2.ogg"],
  "step-concrete": ["step1.ogg", "step2.ogg"]
}
```

The keys are:

- guns: `pistol`, `magnum`, `smg`, `rifle`, `battle`, `mg`, `shotgun`, `sniper`, `rpg`
- `explosion`
- footsteps: `step-<surface>`
- reloads: `reload-<weaponId>`

Any key you provide replaces the synthesised version. Only use recordings you have the rights to (for example licensed packs or CC0 sources).

---

## Music

- **Battle theme:** the official POD track (`client/public/audio/pod-theme.ogg`, plus an `.m4a` copy for iPhones).
- **Menu theme:** `client/public/audio/pod-menu.*`, an Afro-cinematic loop with talking drum, shekere, congas and kalimba. It was composed in code and recorded to a file, so nothing is generated while you play.
- **How it plays:** music runs on the device's own media player, separate from the game's sound effects. Heavy gunfire or a busy phone can't make it crackle, stutter or stop. Each theme loops by crossfading two players, so there is no gap. A watchdog restarts it after calls, screen lock or the app going to the background. If a device can't play `.ogg` it switches to `.m4a`.
- **Sound effects on phones:** a slightly larger audio buffer, cheaper 3D panning, a shorter reverb, and a limit on how many sounds play at once (far-away ones are skipped first).
- **Victory and defeat** stingers at the end of each match.

In **Settings** (in the lobby and in the in-game menu) players can turn background music on or off, turn gun sounds on or off, and set music and sound-effect volume separately.

## Android app (APK)

Every push to `main` builds an Android APK with GitHub Actions (`.github/workflows/android.yml`) and publishes it on the repo's **Releases** page.

1. Push the code to GitHub.
2. Open the repo → **Actions** and wait for "Android APK" to finish (about 5–8 minutes).
3. Open **Releases**, download `proof-of-duty.apk` on your phone and install it (allow "Install unknown apps" when asked).

The app connects to `https://three6states.onrender.com`. To point it at another server, add a repository variable `GAME_SERVER` under **Settings → Secrets and variables → Actions → Variables**.

The app (id `ng.tcee.proofofduty`, version 0.1) opens full screen in landscape, with its own icon and splash screen (from `android-res/`). This is a debug-signed build for testing and sharing. Publishing on the Play Store needs a release signing key; ask and the workflow can be extended.

## Controls

| Desktop | |
| --- | --- |
| WASD | Move |
| Shift | Sprint (uses stamina; you cannot shoot while sprinting) |
| Ctrl / C | Crouch |
| Z | Quiet walk |
| Space | Jump |
| Left / right mouse | Fire / aim down sights |
| R | Reload |
| 1 / 2 / 3, wheel, Q | Primary / pistol / machete; Q switches to the last weapon |
| 4 then G | Pick a grenade, then throw it |
| B | Buy (at your base or just after deploying) |
| E | Revive a downed teammate; plant or defuse the bomb (hold) |
| H / T | Chase cam on/off / scout drone |
| J | Chat with the business on the advert you are aiming at |
| V, then 1–6 | Quick chat |
| Shift (while scoped) | Hold your breath to steady the sniper scope |
| X | First aid kit |
| 5 / 6 | Recon drone / artillery (aim, then click) |
| Tab | Scoreboard |
| Y / U | All chat / team chat |
| Esc | Menu and settings |

On phones and tablets the game switches to touch controls:

- **Move:** a joystick appears wherever your left thumb lands. Push it to the top edge to sprint.
- **Look:** drag anywhere on the right half.
- **Fire:** the big button on the right, or the small one on the left. Both also steer your aim while held.
- **Buttons:** aim (toggle), reload, jump, crouch (toggle), switch weapon and grenade. Revive and first-aid buttons appear only when you can use them.
- **Top right:** buy, scores and menu.

In the browser, the game goes full screen in landscape when you deploy. Players set touch look speed in Settings.

You can link straight into a battle with `/?state=lagos&as=police&mode=bomb` (`mode` is `conquest`, `tdm` or `bomb`), or into a campaign stage with `/?stage=0`.

---

## Project layout

```
client/            browser game (Vite)
  index.html
  src/main.js      boot → sign in → war map → battle
  src/game.js      the battle: local fighter, remote fighters, every server event
  src/camera-modes.js  chase cam and scout drone
  src/ad-chat.js   aim at an advert to chat with the business
  src/ui/chat.js   chat window and Inbox
  src/modes-client.js  mode HUD: bomb, rounds, waves, quick chat
  src/world/       billboards (skyline towers, LED screens, HD ad loading and rotation), arena (terrain, buildings, sky, water), ambience (clouds, smoke columns, birds, flyovers), props (trees, landmarks, machinery), markers (ad walls, gems, sites)
  src/characters/  jointed soldiers in faction uniforms
  src/fps/         first-person viewmodel, procedural guns, effects
  src/core/        audio, music, input, network, server address, textures, quality presets
  src/ui/          cinematic boot, war map, HUD
server/
  index.js         HTTP, WebSocket, accounts, lobby, admin API
  match.js         authoritative battle simulation (20 Hz)
  modes.js         game mode rules (Hold Ground, Gbas Gbos, Plant & Defuse, Campaign)
  bots.js          bot AI (A* pathing, aiming, strafing, grenades, killstreaks)
  ads.js           billboards, bookings, rotation and privacy-safe analytics
  inbox.js         player ↔ business conversations
  daily.js         daily login rewards and missions
  advertisers.js   advertiser accounts for the portal
  paystack.js      Paystack payments, verification, refunds, webhook signatures
  media.js         advert images (Supabase Storage or local files)
  store.js         persistence (Supabase table or local JSON)
  advertise.html   the self-serve ad portal (/advertise)
  admin.html       super admin panel (/admin)
  admin-routes.js  super admin API: players, battles, moderation, notifications, settings, team
  control.js       live settings, maintenance, events, bans, mutes, reports, stats, admin roles, audit
  push.js          push notifications (Web Push with VAPID, and Firebase for the Android app)
  test.js          simulation tests
  test-ads.js      ad portal end-to-end tests
  test-admin.js    admin panel and push end-to-end tests
shared/            states, config, map generator and physics, used by both client and server
android-res/       app icon and splash screen for the Android build
capacitor.config.json, .github/workflows/android.yml   Android app build
```

## Deploying

Any Node 20+ host that supports WebSockets works, for example Render, Railway, Fly.io or a VPS:

1. Run `npm run build`.
2. Run `npm start`.
3. Set the Supabase variables above, so data survives restarts. Without them it falls back to JSON files in `DATA_DIR`, which only works on a persistent disk.

One server process runs every state's battle. For very large player counts, the next step is one process per region, plus a database instead of JSON files.

## Honest limits of this version

- **Graphics.** Everything (textures, weapons, soldiers) is generated in code, so the game loads instantly and needs no asset downloads. The renderer uses PBR lighting, shadows, bloom, colour grading, sun glare and blended terrain, with an Ultra setting for gaming PCs. The resolution adapts automatically to keep the frame rate smooth. For a true AAA look, swap in photo-scanned textures and rigged 3D models (`.glb`); the code is structured so those can replace the generated ones.
- **Testing.** Gameplay, networking and the server were tested headlessly. Rendering was checked with a software renderer, so test it on your target phones before launch.
- **Anti-cheat.** The server checks speed, teleporting, walls, fire rate and shot origin. A public launch should add rate-limits per IP and server-side logging.

---

## About

**Proof of Duty** V0.1. © Tcee. Designed and developed solely by Tcee, a Nigerian developer.
