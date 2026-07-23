# Mini Tetris

A small, self-contained Tetris game — no build step, no dependencies. Just open
`index.html` in a browser.

## Features

- **Score + high score** — live score plus a high score persisted in
  `localStorage` (survives reloads).
- **Levels & lines** — speed ramps up every 10 cleared lines.
- **AMOLED theme** — pure-black (`#000`) background so OLED pixels switch off
  entirely, with neon-tinted tetrominoes for contrast.
- **Google Analytics** — game events are pushed to the GA/GTM `dataLayer` as
  user-interaction data.

## Controls

| Key             | Action        |
| --------------- | ------------- |
| ← / →           | Move          |
| ↑               | Rotate        |
| ↓               | Soft drop     |
| Space           | Hard drop     |
| P               | Pause / resume |

On touch devices, on-screen buttons appear below the board.

## Google Analytics setup

The page ships with a placeholder Measurement ID. To enable real GA4 tracking:

1. Open `index.html`.
2. Replace `G-XXXXXXXXXX` with your GA4 Measurement ID:
   ```js
   window.GA_MEASUREMENT_ID = 'G-XXXXXXXXXX';
   ```

Until a real ID is set, `gtag.js` is **not** loaded — events are still queued on
`window.dataLayer`, so you can inspect them in the console or wire up Google Tag
Manager instead.

### Events pushed to `dataLayer`

| Event                | Parameters                                   |
| -------------------- | -------------------------------------------- |
| `tetris_game_start`  | `high_score`                                 |
| `tetris_line_clear`  | `lines_cleared`, `score`, `level`            |
| `tetris_level_up`    | `level`                                       |
| `tetris_pause`       | —                                            |
| `tetris_resume`      | —                                            |
| `tetris_game_over`   | `score`, `level`, `lines`, `new_high_score`  |

## Running locally

Because the game is fully static, you can just open the file directly, or serve
the folder:

```bash
cd tetris
python3 -m http.server 8000
# then visit http://localhost:8000
```
