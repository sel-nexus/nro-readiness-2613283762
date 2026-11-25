# NRO Readiness · West Metro

A local workshop board for the Harbor Ring rollout. The fixed board clock is **12 May 2026, 09:40 West Metro time**. Assessment results replay known inputs. A score is not approval, and approval to change a plan is not authority to send a crew.

## Run locally

Use Node.js 24 and npm. From the repository root:

```sh
cd frontend
npm ci
npm run dev
```

Open the local URL printed by Vite. Choose **Continue** on a West Metro team row; no password is required for this path. The credential form is also available for the six workshop accounts. The application does not require a server API, deployment secrets, or outside services. `PREVIEW_PORT` is optional for browser tests; the bundle has no runtime settings.

## Walkthrough

1. **Marcus Hale:** Review the 16 released sites and open Harbor Point. In Evidence, inspect Power; in Prediction, compare 34% readiness with 86% confidence. The power blocker is not cleared by confidence.
2. **Elena Voss:** Update an evidence row and verify the previous score remains dated. Attach the supported Harbor Point note or another PDF/PNG/JPG to see the two extraction outcomes. The board stores metadata and available text, not bytes.
3. **Priya Raman:** Open Portside → Approval. Review the supplier/date change and approve it with a rationale of at least 12 characters. Inspect the local ECO workflow and expandable Audit record.
4. **Andre Cole:** Confirm Civic Center dispatch under the existing authorization for Luis Ortega’s crew of four on 16 May at 07:00. Compare the blocked Portside dispatch and existing Harbor Point hold.
5. **Samira Qureshi:** In Service health select **Service interruption**. On Harbor Point → Prediction, run assessment, then Retry twice. The first retry retains the timestamp; the second recovers assessment without recovering DDL. Restore the baseline from Service health or the account menu; cancel is safe, confirmation discards board edits and leaves Samira signed in.

## Verify and package

```sh
cd frontend
npm test
node node_modules/@playwright/test/cli.js install --no-shell chromium
npm run e2e
npm run build
```

`npm test` runs Node storage/fixture tests and Vitest domain tests. Playwright starts a production preview by default. Use a separate browser profile/origin for verification. To build the static image from the repository root: `docker build -t nro-readiness frontend`, then `docker run --rm -p 8080:8080 nro-readiness`. The load balancer probes `/`; the container serves the SPA for extensionless routes so it can render its not-found view. Missing assets still return HTTP 404, HTML is revalidated, and hashed assets are immutable. Deploy a tested digest; verify deep links, cache behavior and asset availability before promotion.

## Limits

Use one editing tab per browser profile and origin. Work persists only in that browser. Local persona controls are not production authentication, and the audit is not tamper-proof. Recovery restores the shipped baseline, not an external backup. After initial asset load the workflow needs no network; a cold offline page load is not supported. No crew, supplier, assessment service, telemetry endpoint, or operational system is contacted.
