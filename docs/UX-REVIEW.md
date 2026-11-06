# UX review — 2026-11-05

A walk through every main screen of the local build (demo family, phone width). Work through it top to bottom; tick items off as they land.

## Getting around

- [ ] **Four taps to reach a memory** (Library → Child Profiles → Banks → Milestones). Add a strip of recent memories at the top of each child's page.
- [x] **Timeline is a main tab that only says "Coming soon".** Hide it until it's built. Done: built instead — a thread by year, newest first, with month dividers, children's ages on each memory and each birth as a landmark.
- [ ] **The gear opens the Family Hub.** The hub is about the family, not settings. Pick one icon and one way in.

## Home

- [x] **Text-only memories show as blank gradient tiles** on Home and in Mosaic. Use the quote card that Related Memories already uses. Done: Home tiles use `CardArt` (quote, waveform or video poster); Mosaic uses `QuoteArt` sized to the tile. Excerpts now end on a word with "…".

## Library

- [x] **Pillar cards are wider than the page content** (about 8px past the header each side). Done, on Child Profiles too.
- [x] **Each pillar card has both a pencil and an arrow button.** Make the whole card the tap target; move editing into a long-press or "…" menu. Done: arrow removed, pencil kept (a long-press can't open the web photo picker).
- [x] **Pillar cards show no count.** Add one ("12 memories"). Done: shown above the title when non-zero.
- [x] **Search bars and year filters on tiny lists** (7 collections; 1 memory). Show them only past roughly 10 items. Done: `SEARCHABLE_LIST` in theme.ts; year chips also need 2+ years.
- [x] **Collection memory lists are text only.** Add a thumbnail when the memory has a photo. Misread: photo memories already had one. Voice and video thumbnails now use `CardArt`.

## Memory detail

- [x] **The story is bold serif, same as the title.** Heavy for long text. Use regular-weight body type; keep bold for the title.
- [x] **"Who was there" is an unlabeled brown circle.** Show an initial or name. Done: names follow the avatars.
- [x] **Dates disagree:** "JUN 21, 2025" at the top, "Summer 2025" in Memory Details. Show one. Done: "Happened in" row removed.
- [x] **Every related memory is tagged "Suggested".** Remove the tag. Done; "Linked" stays for memories linked by hand.
- [x] **The white card runs on into empty space.** End it after the last section.

## Capture

- [x] **"Tell a story" opens a form that leads with media buttons.** Put the story field first for that entry point; keep media first for "Capture a moment". Done: media leads only when the form opens with media attached.
- [x] **The Title placeholder looks like real text** ("The morning we found out"). Lighten placeholders or prefix "e.g.". Done: "e.g." on Title and Place.
- [x] **Date shows as `2026-11-05`.** Use a friendly format or picker ("Today · Nov 5"). Done: `DateField` — datetimepicker on iOS/Android, the browser picker on web. Not yet tried on a device.
- [ ] **"Saved by" offers a single option.** Hide it unless more than one member can add memories.
- [x] **"Where it belongs" mixes two levels of chips** (pillars, then their collections) with no visual distinction. Default it from where the user started (e.g. Banks → Milestones via "Add to this collection") and collapse it otherwise. Done: collapsed row, pillar tabs, chips grouped by child.

## Family Hub

- [x] **"Downloading — Per memory: open one, then ··· → Download"** is instructions, not a setting. Drop it until bulk export exists.
- [x] **"Media: 1" beside "Memories: 5" is unclear.** Make it specific ("1 photo") or drop it. Dropped.

## Keep

The voice and copy, the compact collection list with coloured icons, the error screens, and the quote cards for text-only memories.
