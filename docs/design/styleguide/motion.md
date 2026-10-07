# Motion

Screens slide, sheets rise, bars grow. With Reduce motion on, everything is still (UI-MOT-3). Press Play to replay.

| Class | Moment | Duration | Easing | What moves |
|---|---|---|---|---|
| `.enter-fwd` | Screen pushed | 0.42s | `cubic-bezier(.32,.72,0,1)` | Slides in from the right |
| `.enter-back` | Back | 0.38s | `cubic-bezier(.32,.72,0,1)` | Previous screen slides in from the left (−28%), fading from 0.6 |
| `.sheet` | Sheet opens | 0.42s | `cubic-bezier(.32,.72,0,1)` | Slides up from the bottom |
| `.scrim` | Dimmed layer | 0.3s | `ease-out` | Fades in |
| `.progress` | Bars | 0.8s after 0.3s | `cubic-bezier(.2,.8,.2,1)` | Grows from the left |
| `.chart-line` | Chart line | 1.1s after 0.3s | `cubic-bezier(.4,0,.2,1)` | Draws from left to right |
| `.success-icon` | Saved tick | 0.4s after 0.25s | `cubic-bezier(.2,.8,.2,1)` | Pops in |
| `.shake` | Wrong password | 0.4s | `ease` | Shakes sideways |
| `.expand` | Row opens in place | 0.22s | `ease-out` | Fades down 6px |
| `.(any button)` | Press | 0.12s | `ease` | Scales to 97% (keys 92%) |


