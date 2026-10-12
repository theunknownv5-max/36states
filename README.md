# 36 States

**The battle for Nigeria.** A tactical online first-person shooter played across all 36 states of Nigeria and the FCT. You choose a state and choose what you are (Police, Army, Civil Defence or Vigilante Hunters against Bandits, Creek Militants or Smugglers). Then you fight real players for that state's real natural resources.

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
| `DATA_DIR` | `./data` | Where accounts, profiles and adverts are saved (JSON files) |
| `VITE_SERVER_URL` | same host | Set at build time if the game server lives on another domain (e.g. `wss://api.example.com/ws`) |

To run the simulation tests, use `npm test`. It plays bot battles in every state and checks hits, revives, gems, respawns, explosives, artillery and ad analytics. All 34 checks pass.

---

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

## Selling the walls: the advertiser dashboard

To sell the walls, open **`/admin`** and sign in with your `ADMIN_KEY`. From there you can:

- Upload an advert image and choose which states show it (or all 36 + FCT).
- Set dates and the price paid.
- Watch live reports for each campaign:
  - **Views** (a player actually had the wall on screen, within 45 m, not blocked by walls or smoke)
  - **Unique players**
  - **Gem pickups** from that advert
  - Breakdowns by **state, side, faction and hour of day**
  - CPM
  - CSV export

**Privacy.** Advertisers only see aggregated numbers. Unique players are counted with salted hashes, and no names, accounts or locations are ever exposed. This keeps you on the right side of Nigeria's data protection rules (NDPA). Have a lawyer confirm the details before you sell.

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

The soundtrack is also composed live in code, with talking drum, shekere, congas, kalimba, pads and bass:

- **Menu theme:** slow and cinematic.
- **Battle theme:** gets more intense as the fighting around you heats up, and calms down in quiet moments.
- **Victory and defeat** stingers at the end of each round.

Players set music and sound-effect volume separately in Settings.

## Android app (APK)

Every push to `main` builds an Android APK with GitHub Actions (`.github/workflows/android.yml`) and publishes it on the repo's **Releases** page.

1. Push the code to GitHub.
2. Open the repo → **Actions** and wait for "Android APK" to finish (about 5–8 minutes).
3. Open **Releases**, download `36-states.apk` on your phone and install it (allow "Install unknown apps" when asked).

The app connects to `https://three6states.onrender.com`. To point it at another server, add a repository variable `GAME_SERVER` under **Settings → Secrets and variables → Actions → Variables**.

The app opens full screen in landscape, with its own icon and splash screen (from `android-res/`). This is a debug-signed build for testing and sharing. Publishing on the Play Store needs a release signing key; ask and the workflow can be extended.

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
| E | Revive a downed teammate |
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

You can link straight into a battle with `/?state=lagos&as=police`.

---

## Project layout

```
client/            browser game (Vite)
  index.html
  src/main.js      boot → sign in → war map → battle
  src/game.js      the battle: local fighter, remote fighters, every server event
  src/world/       arena (terrain, buildings, sky, water), props (trees, landmarks, machinery), markers (ad walls, gems, sites)
  src/characters/  jointed soldiers in faction uniforms
  src/fps/         first-person viewmodel, procedural guns, effects
  src/core/        audio, music, input, network, server address, textures, quality presets
  src/ui/          cinematic boot, war map, HUD
server/
  index.js         HTTP, WebSocket, accounts, lobby, admin API
  match.js         authoritative battle simulation (20 Hz)
  bots.js          bot AI (A* pathing, aiming, strafing, grenades, killstreaks)
  ads.js           advert rotation and privacy-safe analytics
  admin.html       advertiser dashboard
  test.js          simulation tests
shared/            states, config, map generator and physics, used by both client and server
android-res/       app icon and splash screen for the Android build
capacitor.config.json, .github/workflows/android.yml   Android app build
```

## Deploying

Any Node 20+ host that supports WebSockets works, for example Render, Railway, Fly.io or a VPS:

1. Run `npm run build`.
2. Run `npm start`.
3. Keep `DATA_DIR` on a persistent disk.

One server process runs every state's battle. For very large player counts, the next step is one process per region, plus a database instead of JSON files.

## Honest limits of this version

- **Graphics.** Everything (textures, weapons, soldiers) is generated in code, so the game loads instantly and needs no asset downloads. The renderer uses PBR lighting, shadows, bloom, colour grading, sun glare and blended terrain, with an Ultra setting for gaming PCs. The resolution adapts automatically to keep the frame rate smooth. For a true AAA look, swap in photo-scanned textures and rigged 3D models (`.glb`); the code is structured so those can replace the generated ones.
- **Testing.** Gameplay, networking and the server were tested headlessly. Rendering was checked with a software renderer, so test it on your target phones before launch.
- **Anti-cheat.** The server checks speed, teleporting, walls, fire rate and shot origin. A public launch should add rate-limits per IP and server-side logging.
