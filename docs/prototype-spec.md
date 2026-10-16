# Foothold prototype: rules as built

This records every rule the first prototype implements, including the ones the [project description](foothold-project.md) left undefined. Where the prototype departs from the description, it says so and why. All numbers live in `src/sim/data.ts`.

**Scope (§14.6):** one hand-built 40×40 map, four colonists, three attacks, two species (Grazers and Rootcrawlers), the adaptation rule, dissection reports, scars, building drops, and growth between attacks.

**Not in the prototype:** the other six colonists and five roles, six species, the beacon and Earth's ship, taken colonists, Carriers, the signal mast, the armoury, the shelter, the water plant, and stores consumption.

---

## 1. Problems in the description and how the prototype resolves them

### 1.1 The adaptation rule could not be computed as written

"What killed the most" across four categories compares counts that don't share a unit. Weapon and body part each have 4 values, position has 4, and time has 2. Kills spread over fewer values, so raw counts or raw shares favour time for that reason alone.

**Resolution.** For each value, the mind measures *concentration*:

```
share         = kills with this value / all kills in the attack
concentration = (share − 1/n) / (1 − 1/n)        n = number of values in the category
```

Concentration runs from 0 (an even spread or less) to 1 (every kill), whatever the category's size. The mind pushes the adaptation for the most concentrated value.

- Shares are taken over **all** kills, not just the kills that had a value in that category. Grenade and flamer kills hit no particular body part. Without this, one aimed kill in an attack of area kills would make the body-part category look 100% concentrated. A unit test found this bug.
- **Ties** go to the category adapted least recently, then to the fixed order weapon › part › position › time.
- **It never pushes the same change twice.** If the top value's adaptation already exists, the mind takes the next candidate.

The rule is fixed and learnable, and false lessons work. Three deliberate flamer kills outweigh one rifle kill to the legs, so the world adapts to fire (`tests/mind.test.ts`). The probe found the same effect in ordinary play: a bot that sometimes knifes creatures dilutes its weapon category, so the world adapts to body shots instead of bullets (§5).

### 1.2 The "time" category had no counter

| Kills came… | Adaptation | Effect |
|---|---|---|
| Early (turns 1–3) | Staggered arrival | Three waves (turns 1, 3, 5) instead of two (1, 3), so an overwatch trap catches fewer |
| Late (turn 4+) | Surge | Everything arrives on turn 1 with +2 move on turns 1–2 |

### 1.3 "Come from underground" overlapped with Rootcrawlers

**Resolution:** adaptations change bodies and timing only, and routes belong to species. The high-ground adaptation is *Climbers*: elevation gives no aim bonus and no cover reduction against them, and they go for colonists standing on raised ground within 10 tiles.

### 1.4 Scars

As written. Six scar types make a repeat scar unlikely: two random scars match 1 time in 6, so the "third downing kills" rule decides most outcomes. The third downing kills at the moment it happens, not after the battle, so the player sees it.

### 1.5 Beacon

Not in the prototype, which has three attacks. What happens if the beacon is not dropped by the seventh attack is still open for the full game.

### 1.6 Intent selection

Implemented in this order:

1. Attack 1: the landing pod.
2. Half the colonists or fewer alive: the colonists.
3. A building dropped since the last attack: that building.
4. Otherwise, the building with the fewest walls within 2 tiles (ties: lowest HP).
5. Nothing standing: the colonists.

**Not implemented:** "the building that most improved the colony's last result". The description doesn't define how to measure improvement. That needs a definition before it can be built.

### 1.7 What losing an attack costs

The description says losing means "what did they reach". The prototype makes that concrete. A reached building is destroyed and stays destroyed, so its function is gone. If the pod falls, half the remaining stores go with it. A "colonists" intent is reached when half of those who started the attack are down or dead.

---

## 2. Combat

- **Turns:** two actions per colonist. Moving within mobility costs 1 action, and dashing to double mobility costs 2. Shooting, throwing, and overwatch end the colonist's turn. Stabilising a downed ally costs 1 action.
- **Hit chance (§14.1, decided):** visible percentages with honest rolls. The target panel lists every modifier. The log prints the chance and the roll, and a hit means roll < chance (0–99).

```
chance = aim + range + body part + cover + height + adaptations (+ overwatch)
```

| Modifier | Value |
|---|---|
| Half cover / full cover | −20 / −40 |
| Shooter higher than target | +10, and the target loses one level of cover |
| Torso / legs / sense organ / head | 0 / −5 / −20 / −30 |
| Overwatch | −15 (−25 with a lost eye, −45 with a tremor) |

- **Body parts:** torso +1 damage; legs −1 damage and slows (−3 move); sense organ −1 damage and blinds for 2 enemy turns (the creature wanders and only strikes what is adjacent); head kills outright.
- **Cover:** taken from the neighbouring tile on the attacker's side. Rock, buildings, walls, and higher ground give full cover. Low walls, trees, thorn, and rubble give half. A wall with 2 or more growth contacts loses one level.
- **Area weapons** (grenade, flamer) land on the chosen tile with no roll, hit everyone in a 3×3 area including colonists, and record no body part. Grenades destroy low walls and growth. Flamers burn growth and trees, and burned ground never grows back.
- **Downed:** at 0 HP, a colonist bleeds out in 3 enemy turns (4 with an infirmary) unless an adjacent ally stabilises them. Survivors get a random scar after the battle.

### Colonists

| Role | HP | Aim | Weapons |
|---|---|---|---|
| Rifleman | 7 | 70 | Rifle, grenade (1), knife |
| Marksman | 5 | 76 | Long rifle (heavy), pistol, knife |
| Engineer | 6 | 58 | Pistol, flamer (2, heavy), knife |
| Xenobiologist | 4 | 48 | Pistol, knife |

### Species (fixed tactical rules)

| Species | HP | Move | Behaviour |
|---|---|---|---|
| Grazer | 4 | 7 | Runs for the intent. Gnaws a building (1) if adjacent, otherwise bites an adjacent colonist (75%, 2), otherwise flicks quills at a colonist within 4 (60% − cover, 1). |
| Rootcrawler | 7 | 4 (5 underground) | Moves underground in a straight line under anything but rock, and cannot be shot there. Surfaces near the target or next to a colonist, which triggers overwatch. Then gnaws (2) or slams (75%, 3). |

### Adaptations

| Category → value | Adaptation | Effect |
|---|---|---|
| Weapon → ballistic | Layered chitin | Bullets −1 damage |
| Weapon → fire | Wet hide | Fire −1 damage, no burning |
| Weapon → explosive | Packed bodies | Explosives −2 damage |
| Weapon → blade | Barbed hide | Blades −1 damage; attacker takes 1 |
| Part → legs | Leg plates | Leg shots −15, no slow |
| Part → torso | Keeled chest | Body shots −1 damage |
| Part → head | Sunken head | Head shots −15 |
| Part → sense | Hooded senses | Sense shots −10, no blinding |
| Position → high ground | Climbers | No height advantage against them; hunt colonists on raised ground |
| Position → cover (mid-range, 4–9 tiles) | Hooked limbs | Their attacks treat full cover as half and ignore half |
| Position → close (≤ 3 tiles) | Lunge | +1 move, +1 damage up close |
| Position → long (≥ 10 tiles) | Mottled skin | Shots from 10+ tiles −20 |
| Time → early | Staggered arrival | See §1.2 |
| Time → late | Surge | See §1.2 |

Adaptations apply to every species, including species that first appear later.

**How the player finds out (§14.5, kept open):** the rule is never stated in the interface. With the xeno lab staffed by the xenobiologist for one day, the player gets a dissection report in plain language. Without it, the battle log describes each adaptation the first time it affects a shot or an attack.

---

## 3. Between attacks

Three days, one assignment per colonist per day: rest (+2 HP), heal (full HP with an infirmary, +2 without), build, repair, staff, clear growth, or train (2 days, scarred colonists only). Everyone also heals 1 HP each night.

| Building | Cost (stores) | HP | Effect |
|---|---|---|---|
| Landing pod | (on landing) | 20 | Holds the stores |
| Xeno lab | 4 | 12 | Staffed by the xenobiologist: dissection report |
| Infirmary | 3 | 12 | Heal restores full HP; bleed-out takes one turn longer |
| Workshop | 3 | 12 | Staffed by the engineer: anyone can build full walls that day |

Starting stores: 7. Salvage: 1 per kill. Walls draw on salvage first, then stores. A low wall costs 1 and a full wall costs 2. The engineer builds 2 segments per day, and everyone else builds 1.

After each attack, thorn spreads 6 + 3 × (attacks so far) tiles. It grows from existing growth and trees and leans toward the colony.

### Departures from the description

| Description | Prototype | Why |
|---|---|---|
| Only the quartermaster can request a drop | Any day, no one needed | There is no quartermaster in the roster of four |
| The infirmary needs a medic | No staff needed | There is no medic in the roster of four |
| Shell shock: cannot be first into a room | Cannot end a move next to a creature | There are no rooms |
| Burned lungs: coughs and gives away position | Creatures within 8 tiles target them first | A mechanical version of "gives away position" |
| Signaller shows the next approach | The intent is shown at deployment, the approach only when the attack begins | There is no signaller; showing the intent makes deployment a real decision |

---

## 4. Presentation

Human things are boxes and right angles: walls, buildings, colonists, rubble, and the landing pad grid. The world is curves: thorn as arcing tubes, rounded rocks, Grazers with curved spines, and segmented Rootcrawlers. The world idles with a slow breathing motion, and the colony does not move. The battle map and the build map are the same view.

---

## 5. Balance baseline

Measured with `npm run probe` over 50 seeded campaigns with two scripted bots. Neither bot builds walls, drops buildings, or uses fire or grenades, so these are lower bounds, not predictions of human play.

| Bot | Attack 1 held | Attack 2 held | Attack 3 held | Colonists dead per campaign |
|---|---|---|---|---|
| Stands still, shoots torso | 46 / 50 | 0 / 50 | 0 / 50 | 0.06 |
| Guards the target, best shot, repairs the pod | 50 / 50 | 35 / 50 | 4 / 50 | 1.66 (colony fell in 4) |

"Held" includes attacks where they withdrew at the 14-turn limit.

What the numbers show:

- Attack 1 works as the teaching attack.
- Standing still and shooting does not hold attacks 2 and 3. That's intended: the stationary bot's habits always produce Layered chitin, then Keeled chest, so its damage falls.
- **Attack 3 is the main open question.** Whether walls, fire, head shots, and repositioning make it holdable for a person has not been tested. It needs playtesting.

Tuning applied during development, so the history is visible: pod HP 14 → 20; dropped buildings 8 → 12 HP; Rootcrawler HP 8 → 7 and gnaw 3 → 2; Keeled chest −2 → −1 body damage; attack 3 reduced from 8 Grazers and 4 Rootcrawlers to 7 and 3; losing the pod costs half the stores instead of all of them.
