---
id: TASK-4
title: Spec 2 acceptance and the switch-over from Goodbudget
status: To Do
assignee: []
created_date: '2026-10-26T18:32:00Z'
labels:
  - spec-02
  - owner
dependencies: []
references:
  - docs/specs/02-spending.md
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Spec 2 task 19. With the owner, on the Mac mini and the family's phones; record the date and result of each line, or describe the failure, in spec 2 "Trial results". Refs: roadmap spec 2 "Done when", O2, QUA-2; screens HomeOffline, HomeOfflineLocked, HomeWaiting, TransactionsOutbox.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Switch-over: the three envelopes exist with the balances taken over from Goodbudget and Goodbudget is no longer used
- [ ] #2 An expense typed on an iPhone in airplane mode from the limited Home arrives exactly once after reconnecting and also after the app was closed and reopened offline in between
- [ ] #3 The first month change after the switch-over tops up one carry-over and one reset envelope correctly and both show the closed month's closing balance and whether it stayed within budget
- [ ] #4 An expense saved with only an amount is listed in Needs a category with no suggestion and Other labels it
- [ ] #5 An item waiting in the outbox for at least two days is still there and is sent
<!-- AC:END -->
