# Changelog

## Four-program readiness demonstration

- **Programs and navigation:** Added East Bay, North Valley and South Shore alongside the unchanged West Metro baseline. All six seeded personas can select a program without real credentials. Search, notifications and operational routes follow the active program. Updated `App.jsx`, `LoginPage.jsx`, `SharedShell.jsx`, `Portfolio.jsx`, program fixtures, storage, and workspace styles.
- **Focused operational views:** Board now starts with the current decision and four counts, followed by risk, trend, exceptions and the site register. Crews and visits moved to Schedule; morning log and failed visits moved to Activity. Updated `Portfolio.jsx`, `ProgramPanels.jsx`, `ReadinessTable.jsx` and portfolio selectors.
- **Site evidence and prediction:** Added decision headings, observed dependencies, factor-to-evidence navigation, historical score labeling, and outage recovery that keeps the last score. Preserved dispatch, hold, and resequence safeguards. Updated `SiteWorkspace.jsx`, `EvidenceMatrix.jsx`, `PredictionPanel.jsx`, `Recommendation.jsx` and the local assessment service.
- **Approvals and facilitator controls:** Scoped the review queue to the open program, retained unsaved rationale after assessment failure, and included decision provenance in Audit. Service health remains facilitator-only, with editable thresholds, source switches, diagnostics and confirmed morning restore. Updated `ApprovalPanel.jsx`, `AuditPanel.jsx`, `ServiceHealth.jsx`, `RestoreDialog.jsx`, the decision service, and readiness/storage utilities.
- **Interface:** Applied the requested blue-led palette with recognizable rectangular controls, explicit status labels, visible focus, and internally scrollable data tables. Contact displays show only the last four phone digits.

### Compatibility and migration

`/` and `/portfolio` now open Programs; `/board` opens the register. Non-West operational routes carry the active program in the URL; site links remain keyed by site ID. Existing West Metro browser records and account data require no migration. New program stores initialize independently. A confirmed morning restore resets initialized program demo records and thresholds and retains the signed-in persona. No backend, database, real authentication, or live service was added.

Verification coverage includes independent West Metro and identity digests, scoped persistence, decision and dispatch gates, outage behavior, and responsive browser journeys. See `test_report.yaml` for results and remaining checks.
