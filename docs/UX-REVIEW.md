# UX review — 2026-11-05

A walk through every main screen of the local build (demo family, phone width). Work through it top to bottom; tick items off as they land.

## Getting around

- [ ] **Four taps to reach a memory** (Library → Child Profiles → Banks → Milestones). Add a strip of recent memories at the top of each child's page.
- [ ] **Timeline is a main tab that only says "Coming soon".** Hide it until it's built.
- [ ] **The gear opens the Family Hub.** The hub is about the family, not settings. Pick one icon and one way in.

## Home

- [x] **Text-only memories show as blank gradient tiles** on Home and in Mosaic. Use the quote card that Related Memories already uses. Done: Home tiles use `CardArt` (quote, waveform or video poster); Mosaic uses `QuoteArt` sized to the tile. Excerpts now end on a word with "…".

## Library

- [ ] **Pillar cards are wider than the page content** (about 8px past the header each side).
- [ ] **Each pillar card has both a pencil and an arrow button.** Make the whole card the tap target; move editing into a long-press or "…" menu.
- [ ] **Pillar cards show no count.** Add one ("12 memories").
- [ ] **Search bars and year filters on tiny lists** (7 collections; 1 memory). Show them only past roughly 10 items.
- [ ] **Collection memory lists are text only.** Add a thumbnail when the memory has a photo.

## Memory detail

- [ ] **The story is bold serif, same as the title.** Heavy for long text. Use regular-weight body type; keep bold for the title.
- [ ] **"Who was there" is an unlabeled brown circle.** Show an initial or name.
- [ ] **Dates disagree:** "JUN 21, 2025" at the top, "Summer 2025" in Memory Details. Show one.
- [ ] **Every related memory is tagged "Suggested".** Remove the tag.
- [ ] **The white card runs on into empty space.** End it after the last section.

## Capture

- [ ] **"Tell a story" opens a form that leads with media buttons.** Put the story field first for that entry point; keep media first for "Capture a moment".
- [ ] **The Title placeholder looks like real text** ("The morning we found out"). Lighten placeholders or prefix "e.g.".
- [ ] **Date shows as `2026-11-05`.** Use a friendly format or picker ("Today · Nov 5").
- [ ] **"Saved by" offers a single option.** Hide it unless more than one member can add memories.
- [ ] **"Where it belongs" mixes two levels of chips** (pillars, then their collections) with no visual distinction. Default it from where the user started (e.g. Banks → Milestones via "Add to this collection") and collapse it otherwise.

## Family Hub

- [ ] **"Downloading — Per memory: open one, then ··· → Download"** is instructions, not a setting. Drop it until bulk export exists.
- [ ] **"Media: 1" beside "Memories: 5" is unclear.** Make it specific ("1 photo") or drop it.

## Keep

The voice and copy, the compact collection list with coloured icons, the error screens, and the quote cards for text-only memories.
