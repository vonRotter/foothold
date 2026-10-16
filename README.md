# Foothold

Ten colonists. One landing site. Ten attacks from a world that wants you gone.

A turn-based squad tactics game in the browser, built with TypeScript, Vite, and three.js. The design is in [`docs/foothold-project.md`](docs/foothold-project.md). This repository holds the **first prototype** (§14.6 of that document): one hand-built map, four colonists, three attacks, two species, and the world's adaptation rule working. Every rule as built, including the ones the description left open, is in [`docs/prototype-spec.md`](docs/prototype-spec.md).

## Run it

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
npm test           # unit tests for the rules (vitest)
npm run typecheck
npm run build      # static build in dist/, runs from any folder
npm run probe      # balance probe: 50 seeded campaigns with two scripted bots
```

## Controls

| Input | Action |
|---|---|
| Left click | Select a colonist, move, target a creature, place a building |
| Right or middle drag · WASD · arrows | Pan |
| Q / E | Rotate the camera 90° |
| Wheel | Zoom |
| Tab | Next colonist with actions left |
| 1–4 | Fire at torso / legs / sense organ / head when the target panel is open |
| O | Overwatch |
| Space | End turn |
| F | Toggle playback speed |
| Esc | Cancel |

Blue tiles cost one action and yellow tiles cost two. Hovering a destination shows its cover: blue plates are full cover and yellow plates are half.

## Code layout

```
src/sim/        The rules. No rendering code; deterministic from a seed.
  data.ts         All numbers: roles, weapons, species, scars, buildings, adaptations
  map.ts          The hand-built map (ASCII), cover, line of sight
  path.ts         Movement costs and Dijkstra reach
  combat.ts       Player actions, the enemy phase, overwatch; returns events
  mind.ts         The adaptation rule, intent and approach selection, dissection reports
  campaign.ts     Aftermath, scars, world growth, the days between attacks, drops
src/render/     three.js: terrain, units, overlays, picking, camera, event playback
src/ui/         DOM interface and the game-flow controller
tests/          Unit tests for the rules
probe/          Balance probe (npm run probe)
```

The simulation returns a list of events for each action. The renderer plays them back, and the log prints them. Nothing in `src/sim` imports three.js or touches the DOM.
