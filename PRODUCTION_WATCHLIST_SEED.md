# Production Watch List Seed

## Status: DELIVERED ✓

## Summary

Populated all 4 personas with production-quality Watch Lists — 40 tracked entities, 10 per persona. Entities are seeded through `db/seed.sql` using the existing data model with `ON CONFLICT(id) DO NOTHING` for safe re-seeding.

## Personas Populated

| Persona ID | Display Name | Domain | Entries |
|-----------|-------------|--------|---------|
| `policy-pete` | Sterling Digital | Tech Founders / AI Business / Growth | 10 |
| `maga-memester` | Scott Decoded | AI / Coding / Frontier Models | 10 |
| `the-wonkette` | Peptide Tracker | Longevity / Peptides / Healthspan | 10 |
| `progressive-pat` | Chris | Finance / Investing / Markets | 10 |

## 40 Watch List Entries

### Sterling Digital — Tech Founders / AI Business / Growth
| Name | Handle | Entity ID |
|------|--------|-----------|
| Paul Graham | @paulg | ent-paul-graham |
| Naval Ravikant | @naval | ent-naval |
| Garry Tan | @garrytan | ent-garry-tan |
| Greg Isenberg | @gregisenberg | ent-greg-isenberg |
| Shaan Puri | @ShaanVP | ent-shaan-puri |
| Sam Parr | @theSamParr | ent-sam-parr |
| Lenny Rachitsky | @lennysan | ent-lenny-rachitsky |
| Nikita Bier | @nikitabier | ent-nikita-bier |
| Jason Lemkin | @jasonlk | ent-jason-lemkin |
| Pieter Levels | @levelsio | ent-pieter-levels |

### Scott Decoded — AI / Coding / Frontier Models
| Name | Handle | Entity ID |
|------|--------|-----------|
| Andrej Karpathy | @karpathy | ent-karpathy (reused) |
| Sam Altman | @sama | ent-sam-altman |
| Yann LeCun | @ylecun | ent-yann-lecun |
| François Chollet | @fchollet | ent-francois-chollet |
| Andrew Ng | @AndrewYNg | ent-andrew-ng |
| Demis Hassabis | @demishassabis | ent-demis-hassabis |
| Jim Fan | @DrJimFan | ent-jim-fan |
| Simon Willison | @simonw | ent-simon-willison |
| Shawn Wang | @swyx | ent-shawn-wang |
| Riley Goodside | @goodside | ent-riley-goodside |

### Peptide Tracker — Longevity / Peptides / Healthspan
| Name | Handle | Entity ID |
|------|--------|-----------|
| Bryan Johnson | @bryan_johnson | ent-bryan-johnson |
| Peter Attia | @PeterAttiaMD | ent-peter-attia |
| Andrew Huberman | @hubermanlab | ent-andrew-huberman |
| Rhonda Patrick | @foundmyfitness | ent-rhonda-patrick |
| David Sinclair | @davidasinclair | ent-david-sinclair |
| Matt Kaeberlein | @MKaeberlein | ent-matt-kaeberlein |
| Siim Land | @siimland | ent-siim-land |
| Peter Diamandis | @PeterDiamandis | ent-peter-diamandis |
| Eric Topol | @EricTopol | ent-eric-topol |
| Brad Stanfield | @BradStanfield | ent-brad-stanfield |

### Chris — Finance / Investing / Markets
| Name | Handle | Entity ID |
|------|--------|-----------|
| Josh Wolfe | @wolfejosh | ent-josh-wolfe |
| Morgan Housel | @morganhousel | ent-morgan-housel |
| Patrick O'Shaughnessy | @patrick_oshag | ent-patrick-oshaughnessy |
| Matt Levine | @matt_levine | ent-matt-levine |
| Packy McCormick | @packyM | ent-packy-mccormick |
| Ben Thompson | @benthompson | ent-ben-thompson |
| Bill Gurley | @bgurley | ent-bill-gurley |
| Aswath Damodaran | @AswathDamodaran | ent-aswath-damodaran |
| Charlie Bilello | @charliebilello | ent-charlie-bilello |
| Barry Ritholtz | @ritholtz | ent-barry-ritholtz |

## Duplicate Handling

- **Andrej Karpathy** (`ent-karpathy`) already existed in seed from Phase 5A.3 — reused for Scott Decoded subscriptions. No duplicate entity created.
- All entities use `ON CONFLICT(id) DO NOTHING` — re-running seed never creates duplicates.
- All subscriptions use `ON CONFLICT(id) DO NOTHING` — re-running seed never duplicates subscriptions.
- Entity IDs are predictable slugs (`ent-{name}`) — the frontend Watch List add UX also handles dedup by name/handle when adding manually.

## Verification Results

| Check | Result | Details |
|-------|--------|---------|
| `npm run build` | PASS | Seed applied cleanly |
| `npm run typecheck` | PASS | All 39 files pass |
| `npm test` | PASS | 61/61 frontend checks + smoke test |
| `verify:persona-persistence` | PASS | 15/15 checks |
| `verify:persona-intelligence-config` | PASS | 36/36 checks — confirms 41 entities, 10-12 subs per persona |
| `verify:phase5` | PASS | 36/36 checks |

### Entity/Subscription Counts
- Total tracked entities: **41** (40 seeded + 1 pre-existing `ent-karpathy`)
- Sterling Digital: **10** subscriptions
- Scott Decoded: **10** subscriptions (incl. reused Karpathy)
- Peptide Tracker: **10** subscriptions (+ any pre-existing test data)
- Chris: **10** new subscriptions (+ 1 pre-existing Karpathy subscription = 11 total)

## File Changed

Only `db/seed.sql` — added 39 `tracked_entities` INSERT rows (reusing 1 existing) and 40 `persona_entity_subscriptions` INSERT rows.

## Production Portfolio v1

Hermes can begin monitoring all 40 entities immediately. Each persona is configured with a domain-relevant Watch List covering its core area. No manual configuration needed.
