# Pattern: confirm and undo

Rules: UI-NAV-4, UI-ADD-13, UI-TXN-3

Destructive or far-reaching actions are confirmed in a sheet that states the consequence. Quick, reversible actions are not confirmed; they offer Undo instead (saved expense, labelling in Needs a category). A short confirmation that needs no screen of its own is a `.toast` with `role="status"` at the bottom of the page, such as “Thanks! Your feedback is sent.” after the feedback sheet closes (UI-SET-6).
