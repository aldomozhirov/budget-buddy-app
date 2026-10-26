---
id: TASK-2
title: HTTPS trial from a phone in the tailnet
status: To Do
assignee: []
created_date: '2026-10-26T18:32:00Z'
labels:
  - spec-01
  - owner
dependencies: []
references:
  - docs/specs/01-foundation-and-wealth.md
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Spec 1 task 30. The image, compose.yaml and README are built and verified locally; the HTTPS check from a phone is left, with the owner. Refs: DEP-1-8, SEC-8, requirements 10.1 #3. Deployment is now managed outside this repository, so the check is of the deployed app, not of the README's Tailscale Serve steps.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The app opens over HTTPS on a phone with Tailscale on
- [ ] #2 It does not open from the same phone with Tailscale off
- [ ] #3 Spec 1 "Trial results" records both with the date
<!-- AC:END -->
