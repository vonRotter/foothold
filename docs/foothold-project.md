# FOOTHOLD — project description

Ten colonists. One landing site. Ten attacks from a world that wants you gone.

Survive all ten and the ship from Earth lands. Then the world loses.

*(Working title.)*

This is a project description, not a build spec. It records the decisions made so far and marks what is still open. The build spec comes after the open questions in §14 are settled.

**Sources:** XCOM 2 (squad tactics, cover, attachment to named soldiers), Phoenix Point (body-part targeting, an enemy that evolves), Darkest Dungeon (lasting damage), and Star Wars Zero Company (general feel).

---

## 1. Design thesis

**Nothing resets. You fight with what is left.**

Three ideas, and each one is the same idea at a different scale:

*The ground persists.* One map, the whole campaign. What you build stays built, what gets destroyed stays destroyed, and what the world grows between attacks stays there.

*The people persist.* Ten colonists, and no new ones arrive. Wounds become permanent scars, and a scarred soldier is not discarded. They are moved to work that suits who they are now.

*The enemy persists.* The world remembers how you killed it and changes in response. Your best tactic stops working **because** it worked.

### What makes it its own game

- **You are the invaders.** XCOM, inverted. The enemy is the planet, and its motive is easy to understand.
- **Everyone is on the map.** There are no barracks. The medic, the wounded, and the xenobiologist are inside the colony when the attack comes. You don't choose who to bring. You choose where everyone stands.
- **The enemy can be read and manipulated.** The world adapts by a rule the player can learn. Once they know it, they can feed the world false lessons.

### Non-negotiables

- Turn-based squad combat with cover, overwatch, and real positioning. **This is not a tower defence.** See §11.
- A fixed map. The colony never expands.
- Exactly ten colonists. No recruitment, ever.
- Exactly ten attacks. No way to avoid a fight.
- **Every adaptation the world makes can be traced to something the player did.**

### Anti-goals

No base expansion, no recruitment, no tech tree, no global map, no autonomous turrets, no enemy waves on lanes, no diplomacy with the planet.

---

## 2. Setting

A colony ship reaches a world that looked empty from orbit. It isn't.

The planet is one mind spread across its whole biosphere. It does not think in words, and it cannot steer individual creatures. What it can do is **push**: breed, grow, and shift its species in a direction. It wants the colony gone, and it is not wrong to want that.

The first landing team comes down with ten people, the ship's stores, and a set of prefabricated buildings still in orbit. Earth's follow-up ship is coming. It will arrive after the tenth attack.

The game never argues for or against the colony. It shows what happens.

---

## 3. The colonists

**Ten people**, each with a name, a profession, and a portrait.

### Roles

**Combat roles** fight well and do little else:
- **Rifleman** — the dependable standard
- **Marksman** — long range, poor up close
- **Breacher** — close range, heavy armour
- **Pathfinder** — fast and quiet, best at reaching flanks

**Support roles** are worth more outside combat than inside it:
- **Engineer** — builds and repairs between attacks; can crew a turret
- **Medic** — turns fresh wounds into stable scars; decides who goes back on the line
- **Xenobiologist** — dissects the dead and predicts the next adaptation (§8)
- **Quartermaster** — makes stores last; the only one who can request a building drop
- **Signaller** — reads what the world is about to do; shows where the next attack will come from

The starting ten is a fixed mix of both kinds. Every support colonist can fight, just badly.

### Scars

A colonist who is downed in battle survives with a **permanent scar** unless they bleed out.

Scars are concrete and mechanical:

| Scar | Effect |
|---|---|
| Lost eye | Shorter range, worse overwatch |
| Shattered knee | One less move |
| Tremor | Overwatch no longer reliable |
| Burned lungs | Cannot sprint; coughs and gives away position |
| Nerve damage | Cannot use heavy weapons |
| Shell shock | Cannot be first into a room |

**A scar does not take someone out of the game. It reassigns them.** A rifleman with a shattered knee can be retrained as an engineer between attacks. Nobody is wasted, but every person you move into support is one fewer on the wall, for the rest of the game.

A colonist who gets a second scar of the same kind is out of combat permanently. A third downing kills them.

---

## 4. The map

**One map for the whole campaign.** Hand-built, roughly 40×40 tiles, with the landing site in the middle, open ground around it, and three or four natural approaches: a ravine, a ridge, a forest edge, and a dry riverbed.

The map is changed from both sides:

- **The colony** builds walls, trenches, raised platforms, gates, and light posts between attacks.
- **The world** grows thorn mats, root networks, and spore fields between attacks. Growth eats cover, blocks sight lines, and can open new routes.
- **Battle damage** stays. Breached walls stay breached until repaired. Burned forest stays burned.

By the tenth attack the map should look nothing like it did on landing, and every change should be readable as a decision someone made.

---

## 5. Buildings — the drop pods

The ship carries **prefabricated buildings in orbit**. Each one is dropped once, onto a site the player chooses, and then it stays there.

There is no reason to drop a building early. A building costs stores to activate and needs a colonist to staff it. Dropped and empty, it is a target with no benefit.

| Building | Gives | Needs |
|---|---|---|
| Infirmary | Medic can stabilise wounds; downed colonists more likely to survive | Medic |
| Xeno lab | Xenobiologist can dissect and predict | Xenobiologist |
| Workshop | Engineer can build heavier fortifications | Engineer |
| Water plant | Without it, stores run out faster | Nobody, but it is a target |
| Signal mast | Signaller can see the next approach | Signaller |
| Armoury | Better weapons for combat roles | Quartermaster |
| Shelter | A hardened room; non-combatants survive inside it | Nobody |
| Beacon | **Required for Earth's ship to land.** Must be dropped by the seventh attack | Nobody, and it is the world's main target from then on |

Rules:
- **Dropping is irreversible**, and each building takes a fixed footprint on a fixed map. Where you put the infirmary is a decision you live with.
- **The world notices new buildings.** The most recently dropped building is a likely target in the next attack.
- There are more buildings in orbit than you can afford to activate.

---

## 6. Between attacks

A short management phase, a few in-game days, in which each colonist gets one assignment per day:

- **Build** a fortification
- **Staff** a building for its effect
- **Heal** in the infirmary
- **Study** dead creatures in the lab
- **Clear** world growth from the map
- **Train** into a new role, after a scar
- **Rest**

**Resources:**
- **Stores** — finite, from the ship. Every activation and every heavy fortification draws on them.
- **Salvage** — taken from the creatures you killed. What you kill feeds the colony.

There is no money and no research tree.

---

## 7. The attacks

**Ten attacks.** Each is one turn-based mission on the persistent map.

Each attack has an **intent**, chosen by the mind (§8):
- Reach a specific building
- Take colonists rather than kill them
- Cut off the water
- Grow through a defended sector
- Reach the beacon (from the seventh attack on)

**The intent decides what losing means.** It is not "how many got through." It is "what did they reach, and who did they take."

An attack ends when the creatures have reached their intent, withdrawn, or died.

A **taken** colonist is gone, but not confirmed dead. That is deliberately worse.

---

## 8. The mind — legible evolution

**The heart of the game.**

The world is one mind that **pushes** its species but cannot control them. Architecturally that is two AIs:

- **The mind (strategic):** between attacks, it picks the next intent and the next adaptation.
- **Each species (tactical):** during attacks, it behaves by its own fixed rules. The same species always behaves the same way, even when the mind has changed its body.

### The adaptation rule

After each attack, the mind looks at **what killed the most of it**, broken down into four categories:

- **Weapon type** — ballistic, fire, explosive, blade
- **Body part hit** — legs, torso, head, sense organs
- **Position** — from high ground, from cover, at close range, at long range
- **Time** — whether kills came early or late in the attack

It pushes **one adaptation** against the category that hurt it most. Fire did the damage, so the next creatures are fire-resistant. The marksman on the ridge did the damage, so the next creatures come from underground.

**The rule is fixed and the player can learn it.** That is what turns it into a strategy layer rather than a punishment. Once a player understands the rule, they can **feed the world false lessons**: kill with a weapon they don't care about on purpose, so the world wastes its adaptation on that.

### How the player finds out

- **With a xenobiologist** and the lab staffed, the player gets a dissection report between attacks: what the world is changing, in plain language. *"The leg plates on these are thickening."*
- **Without one**, the player finds out in battle.

Losing your xenobiologist should feel like going blind.

### Intent selection

The mind picks its next intent from the state of the colony, and in hindsight the choice should always make sense:

- The newest building
- The building that most improved the colony's last result
- The least defended valuable thing
- The colonists, if the colony has few left
- The beacon, from the seventh attack on

---

## 9. Species

Roughly **eight species** across the campaign. Each one exists to threaten the siege in a specific way, and each is introduced in a particular attack.

| Species | Threat |
|---|---|
| **Grazers** | Fast, fragile, numerous. The first attack. Teaches cover and overwatch |
| **Rootcrawlers** | Burrow under walls and surface inside. Make walls insufficient |
| **Thornbacks** | Heavy and slow. Break fortifications instead of fighting people |
| **Stalkers** | Ignore the soldiers and go for non-combatants |
| **Sporecasters** | Ranged area denial. Cause panic and wreck sight lines |
| **Carriers** | Take colonists rather than kill them |
| **Skimmers** | Fly over walls. Fragile, but ignore the whole fortification layer |
| **Listeners** | Do nothing themselves. Mark positions for everything else |

The mind can push any species along any adaptation, so a Thornback in the eighth attack may not be the Thornback of the third.

---

## 10. Tactical combat

Turn-based, grid-based, squad-focused. The XCOM foundation, with three changes:

**Everyone is on the map.** All living colonists are present for every attack. Non-combatants are positioned before the attack begins, and they can be moved during it. Protecting them is half the job.

**Body-part targeting**, from Phoenix Point. Every shot targets a part — legs, torso, head, or a sense organ — with its own chance to hit and its own effect:
- **Legs** slow it
- **Torso** does the most damage
- **Head** has the lowest chance but is decisive
- **Sense organs** blind it, which breaks its tactical AI

What you aim at feeds the adaptation rule. **Your targeting habits become what the world learns.**

**Two actions per turn**, half and full cover, overwatch, flanking, and elevation. Standard tactical vocabulary, done well, because this game's novelty belongs in the layers around it.

---

## 11. Not a tower defence

The risk is real, because building defences between waves is a tower defence's core loop. These rules keep the game on the right side of the line:

1. **Fortifications never kill anything on their own.** They shape the battlefield — cover, sight lines, chokepoints, elevation. A turret needs a crew member standing at it, and that person is out of position for everything else.
2. **There are no lanes.** Creatures choose their routes, and the map has several approaches. The mind and the species decide, not a path.
3. **Losing is about what was reached, not how many got through.**
4. **Nothing is built during an attack.** Combat happens on the ground you prepared.
5. **The squad does the killing.** A colony with perfect walls and bad positioning should still lose.

If playtesting shows that players win by building the right walls and then barely acting, the design has failed and fortifications must be weakened until positioning decides the outcome.

---

## 12. The ending

**The tenth attack survived:** the follow-up ship lands. The colony holds.

**The colony falls** if every colonist is dead or taken, or if the beacon is destroyed.

Either way, the final screen is plain: who lived, who was taken, who died and where, what the map looks like now, and one quiet line saying what Earth's arrival means for the world. **The game never tells the player how to feel about winning.** Same restraint rule as *The Long Post*.

---

## 13. Presentation and technology

- **Browser game: TypeScript, Vite, and three.js.** *(Changed from the original plan of Python 3.11+, `pygame`, and `numpy`.)* The rules live in a pure simulation module with no rendering code and a seeded random number generator, so every rule can be unit-tested and every campaign replays exactly from its seed. three.js only draws that state.
- **A tilted tactical camera** that can be rotated in 90° steps, panned, and zoomed. Elevation and cover read directly from the 3D view.
- **Flat-shaded and readable.** Visually, the colony and the world are opposites: **human things are straight lines and right angles; the world is curves and growth.** A player can tell at a glance what belongs to whom, and as the world's growth spreads across the colony's straight lines, the picture tells the story. This is buildable from primitives without any illustration.
- Colonists get small portraits. Creatures are defined by silhouette and behaviour, not detail.
- The battle map and the build map are the same view. Between attacks, the player sees the same ground they just fought on.

---

## 14. Open questions

*Decisions taken for the first prototype are marked **Decided**. The full rule set as built is in [`prototype-spec.md`](prototype-spec.md).*

- **§14.1 Decided:** visible hit percentages with honest rolls. Every shot shows its itemised modifiers before you take it, and the log prints the chance and the roll.
- **§14.4 Decided:** hand-built map. Starting growth is fixed in the prototype; how growth spreads between attacks varies with the seed.
- **§14.6 Decided:** the prototype is the map, four colonists, three attacks, two species (Grazers and Rootcrawlers), and the adaptation rule working.
- §14.2, §14.3, and §14.5 remain open. The prototype uses 3 days between attacks, has no taken colonists, and never states the adaptation rule in the interface.

1. **Hit chance: dice or visible fate?** Hidden dice with a 95% miss is XCOM's most hated feature, and this game's whole argument is about legibility. Options: visible hit percentages with honest rolls; a visible fate deck per colonist (the cards from the earlier brainstorm); or deterministic damage with only body-part hits being uncertain. **This decision changes the feel of every battle and should be made before anything is built.**
2. **How long is the between-attack phase?** Too short and assignments don't matter; too long and the game becomes a management sim. Probably 3–5 days.
3. **Can a taken colonist ever come back?** A later attack could include them, changed. It's powerful and expensive to write. Recommend once at most, as a set piece.
4. **Is the map hand-built or generated per run?** Hand-built is better for a first project and lets the player learn the ground. Recommend hand-built, with the starting growth varying.
5. **How visible is the adaptation rule?** Recommend: never stated in the interface, but the dissection reports make the pattern obvious within two or three attacks.
6. **Scope of a first prototype.** Recommend: the map, four colonists, three attacks, two species, and the adaptation rule working. If the third attack feels different because of what the player did in the first two, the game works.
