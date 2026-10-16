# Foothold

Ten colonists. One landing site. Ten attacks from a world that wants you gone.

A turn-based squad tactics game in the browser, built with TypeScript, Vite, and three.js. The design is in [`docs/foothold-project.md`](docs/foothold-project.md). This repository holds the **first prototype** (§14.6 of that document): one hand-built map, four colonists, three missions, two species, and the world's adaptation rule working. Every rule as built is in [`docs/prototype-spec.md`](docs/prototype-spec.md). Credits are in [`CREDITS.md`](CREDITS.md).

## How a campaign runs

1. **Land.** You start in a build phase with a habitat module, a few walls, and some cargo, in the middle of the map.
2. **Build.** Give each colonist a job for the phase. Builders supply build points. Spend them on walls, clearing thorn, and repairs, and spend stores on dropping buildings from orbit. Anything placed this phase can be undone; drops cannot.
3. **Next mission.** A briefing shows what the world is coming for and its fixed wave schedule.
4. **Deploy.** Place everyone inside the colony.
5. **Fight.** Waves arrive on their scheduled turns. The mission ends when every wave has arrived and died, or when they reach what they came for.
6. Back to step 2 with whatever is left. After three missions, the ending.

## Play it

### On GitHub Pages

The workflow in `.github/workflows/pages.yml` tests, builds, and publishes the game on every push to `main` or `claude/great-bardeen-pcyk5b`, and can also be run by hand from the Actions tab.

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions.** The game is then at `https://<owner>.github.io/foothold/`.

### Locally

Requires Node 20.19+ or 22.12+.

```sh
npm install
npm run dev        # http://localhost:5173
```

URL options:

| Option | Effect |
|---|---|
| `?seed=42` | Fixed campaign seed. The same seed and the same choices replay exactly. |
| `?quality=low` | No shadows or antialiasing, for slow GPUs. |
| `?instant=1` | Skip all animation. |

Other commands:

```sh
npm test           # unit tests for the rules
npm run typecheck
npm run build      # static build in dist/, runs from any folder
npm run probe      # balance probe: 50 seeded campaigns with two scripted bots
```

## Controls

| Input | Action |
|---|---|
| Left click | Select, move, target, place. Drag to paint walls or clear thorn. |
| Right or middle drag · WASD · arrows | Pan |
| Q / E · wheel | Rotate the camera 90° · zoom |
| 1–9 | Abilities in battle, tools in the build phase, body parts when aiming |
| Tab | Next colonist with actions left |
| Space | End turn |
| Z | Undo the last placement (build phase) |
| L | Open or close the log |
| F | Enemy turn speed |
| Esc | Cancel |

Blue tiles cost one action and yellow tiles cost two. Hovering a destination shows its cover: blue plates are full cover and yellow plates are half.

## Code layout

```
src/sim/        The rules. No rendering code; deterministic from a seed.
  data.ts         All numbers: roles, weapons, species, scars, buildings, costs, wave schedules
  map.ts          The hand-built map (two ASCII layers: height and features), cover, line of sight
  path.ts         Movement costs and Dijkstra reach
  combat.ts       Player actions, waves, the enemy phase, overwatch; returns events
  mind.ts         The adaptation rule, intent and approach selection, dissection reports
  campaign.ts     Build phase, jobs, placement and undo, aftermath, scars, world growth
src/render/     three.js: terrain, water, units, overlays, picking, camera, event playback
src/ui/         HUD, icons, portraits, and the game-flow controller
tests/          Unit tests for the rules
probe/          Balance probe (npm run probe)
```
