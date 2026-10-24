# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Styling: Tailwind via Uniwind

Styles are Tailwind classes (`className`), compiled by Uniwind
(https://docs.uniwind.dev). Don't add `StyleSheet.create` or hex colours.

- **Theme lives in `src/global.css`** (`@theme static`): every colour, font
  family, radius, named spacing step and shadow. Changing a colour means
  editing that file only. Tailwind's default palette is cleared, so only
  brand tokens exist: `paper surface surface-alt ink ink-soft muted line
  accent accent-deep accent-soft primary on-primary danger danger-soft error
  sage dusk-blue terracotta forest peach cream scrim logo-ink white black`.
  Need a new colour? Add a token there; never an arbitrary `bg-[#…]`.
- **Translucency** uses opacity modifiers: `bg-scrim/62`, `bg-white/14`,
  `text-cream/85`, `bg-ink/42`.
- **Type scale** is utilities: `type-display type-title type-heading
  type-body type-story type-label type-eyebrow type-caption`. Each sets face,
  size, leading and colour; add `text-*` after it to recolour.
- **Fonts**: `font-display font-sans font-sans-semibold font-sans-bold`.
  Never `font-bold`/`font-semibold` — custom fonts ignore weight on Android.
- **Spacing**: Tailwind's 4px scale (old `spacing.xs/sm/md/lg/xl/xxl` = 1/2/3/4/6/9),
  plus page rhythm `gutter top after-header section bottom`
  (`px-gutter`, `mt-section`). Radius: `rounded-sm/md/lg/full`.
  `max-w-page` caps content width. `shadow-card` is the card shadow.
- **Odd one-off numbers** use arbitrary values (`p-[5px]`, `text-[13.5px]`,
  `tracking-[1.4px]`, `leading-[23px]`).
- **Pressed state**: `active:opacity-80` on `Pressable` instead of a
  `({ pressed }) => …` style, when the only thing pressed changes is style.
- **Third-party components** (Ionicons, expo-image) come from `src/styled.ts`,
  wrapped with `withUniwind`; add others there. A colour prop takes an
  `accent-*` class: `<Ionicons colorClassName="accent-ink" />`,
  `<ActivityIndicator colorClassName="accent-muted" />`.
- **A raw colour in JS** (SVG fill, navigator options, a computed style):
  `useColor("ink")` from `src/theme.ts`. Only when no class fits.
- **Computed values** (sizes from `useWindowDimensions`, insets, animated
  values) stay in `style`, next to `className` for everything static.
- `layout` and `MAX_WIDTH` in `src/theme.ts` remain for JS layout math; they
  must match `--spacing-*` / `--container-page` in global.css.
