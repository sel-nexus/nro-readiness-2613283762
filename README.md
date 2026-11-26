# NRO Readiness · West Metro

A local readiness workshop for four rollout programs, including the original West Metro Harbor Ring board. The fixed board clock is **12 May 2026, 09:40 West Metro time**. Assessment results replay known inputs. A score is not approval, and approval to change a plan is not authority to send a crew.

## Run locally

Use Node.js 24 and npm. From the repository root:

```sh
cd frontend
npm ci
npm run dev
```

Open the local URL printed by Vite. Choose **Continue** on a workshop account row; no password is required for this path. The credential form is also available for the six workshop accounts. The application does not require a server API, deployment secrets, or outside services. `PREVIEW_PORT` is optional for browser tests; the bundle has no runtime settings.

## Walkthrough

1. After sign-in, **Programs** lists four cards, each with an **Open Board** link. Use **Programs** to return to the catalog or the **Active program** selector to switch scope from a Board. Site workspaces have a **Board** link that returns to the site’s program.
2. **Marcus Hale — West Metro Cluster 4:** Review the 16 released sites and open Harbor Point. In **Evidence**, inspect Power; in **Prediction**, compare 34% readiness with 86% confidence. High confidence does not clear the blocker.
3. **Priya Raman — East Bay Cluster 2:** Open **Approvals** and review the Marsh Junction supplier/date request. Approve it with a rationale of at least 12 characters, then open the site’s **Audit** to inspect the decision. Switch to West Metro **Approvals** to find the separate Portside request.
4. **North Valley Cluster 1** has two released sites, including the Orchard Exchange pilot. Compare its Board with the six design-only entries on its Programs card. **South Shore Cluster 7** is paused; open its Board and review the Dune Crossing hold after a failed visit.
5. **Elena Voss — West Metro:** In Harbor Point **Evidence**, update a row and check that the previous score remains dated. Attach the supported Harbor Point note or another PDF/PNG/JPG to see the two extraction outcomes. The board stores metadata and available text, not bytes.
6. **Priya Raman and Andre Cole — West Metro:** As Priya, open **Portside → Approval**, approve the supplier/date change with a rationale, and inspect the local ECO and expandable **Audit** record. Switch to Andre from the account menu, reopen West Metro, and compare Portside’s blocked dispatch with Harbor Point’s hold. At Civic Center, confirm dispatch under the existing authorization for Luis Ortega’s crew of four on 16 May at 07:00.
7. **Samira Qureshi — West Metro:** In **Service health**, select **Service interruption**. On **Harbor Point → Prediction**, run assessment, then retry twice. The first retry retains the timestamp; the second recovers assessment without recovering DDL. Restore the baseline from Service health or the account menu; cancel is safe, confirmation discards board edits and leaves Samira signed in.

## Verify and package

```sh
cd frontend
npm test
node node_modules/@playwright/test/cli.js install --no-shell chromium
npm run e2e
npm run build
```

`npm test` runs Node storage/fixture tests and Vitest domain tests. Playwright starts a production preview by default. Use a separate browser profile/origin for verification. To build the static image from the repository root: `docker build -t nro-readiness frontend`, then `docker run --rm -p 8080:8080 nro-readiness`. The load balancer probes `/`; the container serves the SPA for extensionless routes so it can render its not-found view. Missing assets still return HTTP 404, HTML is revalidated, and hashed assets are immutable. Deploy a tested digest; verify deep links, cache behavior and asset availability before promotion.

### Manual native browser zoom check (200%)

The Playwright **200% desktop reflow** case in `frontend/e2e/portfolio.spec.js` uses a 683 × 384 CSS viewport and a device scale factor of 2 as a proxy. It does not set or verify native browser zoom. The headed check below is a procedure, not a recorded pass.

1. Start the app as above and open its URL in a normal, visibly headed Chrome or Chromium window with a fresh profile. Turn off DevTools device emulation and use a desktop-sized window (for example, a 1366 × 768 display with the browser maximized). Open the browser’s **⋮** menu and use **Zoom +** until the menu reads **200%**. Close the menu and keep that zoom for the entire journey.
2. Use **Tab** and **Enter** to continue as Marcus Hale and activate **Open Board** on the **West Metro Cluster 4** card. Confirm the full Board decision is readable without overlap, clipping or page-wide horizontal scrolling. On the Board, use **Tab** to focus the **Site readiness register** scroll area. Verify that the focus outline is visible and that **Right Arrow** reveals columns inside the table without moving the page sideways.
3. Use **Tab** or **Shift+Tab** to reach **Review Harbor Point**, then press **Enter**. Check that the full Harbor Point decision heading, risk and plan are readable without overlap, clipping or page-wide horizontal scrolling. Then tab to the **Evidence matrix** scroll area and check again: the focus outline is visible, and horizontal scrolling stays inside the table, not the page. Move focus to the **Evidence** tab and press **Right Arrow** to reach **Prediction**; check that focus is visible and the 34% readiness and 86% confidence remain readable without page-wide horizontal scrolling.
4. Tab or Shift+Tab to the **Board** link in the site content and press **Enter**. Verify that it returns to **West Metro Cluster 4** with the site register and no page-wide horizontal scroll. Reopen the browser menu to confirm it still reads **200%**. Record the browser version, window size, and any failures separately from the proxy results.

## Limits

Use one editing tab per browser profile and origin. Work persists only in that browser. Local persona controls are not production authentication, and the audit is not tamper-proof. Recovery restores the shipped baseline, not an external backup. After initial asset load the workflow needs no network; a cold offline page load is not supported. No crew, supplier, assessment service, telemetry endpoint, or operational system is contacted.
