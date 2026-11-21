# Header loading artwork

The eight GIFs in this folder are normalized exports from `D:\Omni\gif`:

| Tier | Source | Meaning |
| --- | --- | --- |
| `slow` | `cat.gif` | Plenty of room and a low projected burn rate |
| `on-track` | `horse.gif` | Normal projected burn rate |
| `fast` | `airplan.gif` | Fast burn or limited remaining quota |
| `overshooting` | `sonic.gif` | Heavy process, critical remaining quota, or projected overrun |

Every file is an animated GIF with a 320×240 canvas, 12 frames, 160 ms frame timing, and an
infinite loop. `light` uses the dark ink palette for light surfaces; `dark` uses the light ink
palette for dark surfaces. The header adds the back-and-forth travel motion on top of the GIF's
native animation.

Import the matching mode and tier from the frontend, for example:

```ts
import loadingFastDarkUrl from '../../../assets/loading/converted/loading-fast-dark.gif'
```

## Idle cat

`idle-cat-light.gif` / `idle-cat-dark.gif` are the lazy cat (source `boring_cat.gif`, 12 frames,
70 ms, infinite loop) with its shelf removed, cropped to the cat and scaled to 320 px wide. `dark`
turns the black cat white (and its eyes dark) for dark surfaces. The belly ends at row 158 of 356,
which `IdleCat`'s `perched` mode places on a box's top border.
`ui/ide/ui/IdleCat.tsx` shows the matching one on the empty editor and empty split panes.
