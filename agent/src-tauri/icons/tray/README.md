# Tray icons — hand-designed, do not regenerate

These twelve PNGs are **exports from Arjun's Photoshop file**, not build output.
The source is `trey icons.psd` in `~/Desktop/Curfew Assets/`, which is not in the
repo. There is no script that reproduces them, and one should not be written:
anything generated from `icons/icon.png` produces different artwork, because the
app icon and the menu bar mark are deliberately not the same drawing.

`light/` is the black set, for a light menu bar. `dark/` is the white set, for a
dark one. `tray.rs` picks between them on the system theme.

| file                        | PSD export name           |
| --------------------------- | ------------------------- |
| `idle.png`                  | `black/white idle`        |
| `syncing.png`               | `black/white syncing`     |
| `queued.png`                | `black/white sync pending`|
| `failed.png`                | `black/white failed`      |
| `drive-not-connected.png`   | `black/white drive not con` |
| `format-drift-paused.png`   | *(no PSD source)*         |

`format-drift-paused` is the exception — it was added in Story 3.4, after the
PSD was exported, and has no counterpart on the Desktop. If the set is ever
redrawn, that state needs drawing too; it is easy to miss, because it is the one
state whose absence from the asset folder looks like the asset folder is
complete.

## Why this file exists

On 2026-08-17 these icons were replaced twice in one day by well-meaning work.
A handoff note described them as "the old vinyl record", which read as
placeholder art rather than as the designed set they are, so 0.1.1 shipped a
generated silhouette in their place and had to be reverted. Before changing
anything here, assume the current artwork is intentional and ask.
