# Sprint 2 — Dashboard Premium Duo
Start 24 Nov 2026 (early); official window 26 Nov–9 Dec. Candidate base b03af49, PR #3 pending main. No changes to Sprint 1 closure gates.
## Slice 2.1/2.2
Extract existing V2 category/totals/planned aggregation verbatim in behavior, preserving classification upstream and number arithmetic. No migration, no cloud integration. New summary card displays actual cash, forecast, planned net, budget target, realized flows and sync state. Existing detail/member/envelope sections and actions remain.
## Acceptance
Automated parity scenarios including iOS QA 200 - 35 = 165, carryover, planned, empty, negative, decimal. Validate on iPhone with same QA data, normal and larger text, widths 360/390/430, online/offline. Check Figma reference V3.0.7 before visual signoff; first visual implementation is not pixel-perfect. Android pending. No production use. 

## Second slice
Figma baseline screen 4:89 inspected structurally: scrolling header, balance, monthly breakdown, quick actions, envelopes. Compact header and month picker, official mark rasterized from repository SVG, real envelope summary. Transfer and notifications not implemented; no fake controls. Existing detailed sections retained. User QA 15/15 and iOS 165 EUR on initial slice. Revalidate this slice on device.

## Third slice — 24 Nov
User video confirms compact header and logo, balances 165 EUR; large-text navigation remains a defect. Candidate uses explicit half-width text tabs, no scaling cap, compact wrapping month controls and retains invalid month editor. Monthly breakdown separates objective, report and realized flows. Recent operations are read-only, selected-month realized rows; ties sorted by stable key (not creation time). Existing envelope/member details retained. Shared QA Lab integration deferred. Native re-test required.

## Fourth slice — 24 Nov
Compact envelope cards distinguish cash, remaining budget and spending usage; zero/negative available budget has no percentage bar. Member cards reuse V2 personState, label remaining amounts as contribution objectives (not debts), and retain personal payments. Offline, empty and negative notices are presentation only. Full envelope details remain accessible on dashboard. Native video on previous slice confirms normal layout and 165 EUR; recent operations and large text still need targeted review. QA Lab integration remains separate.

## Fifth slice — shared QA Lab
Opt-in web-only preview on Sprint 2 branch, same DashboardOverview and model, coherent EUR fixtures (normal 165, negative -35, empty 0, future 165/125, offline 165). Other destinations illustrative. Width override and large-layout switch are not native font scaling. Native hero fade only when reduced motion query permits; no amount animation. CI exports normal and preview separately; preview artifact, no public deployment. Run EXPO_PUBLIC_DUO_PREVIEW=1 npx expo start --web -c; unset variable for native QA. Prior preview branch unchanged. Verify browser and iPhone before signoff.

## Recette native V5 — 24 novembre 2026
Validation déclarée par le propriétaire sur iPhone : 10/10 scénarios prioritaires réussis (solde réel/prévisionnel 165 EUR, bilan et objectif, enveloppes et consommation, opérations réalisées, membres, accès dépenses/versements, grande police, scroll et barre fixe, réduction des animations, retour à taille normale). Preuve : checklist utilisateur, pas de nouvelle vidéo requise. CI 45458376244 verte sur f4e6fd7 : tests navigation/dashboard/preview, assertions Glance, deux exports Web et artefact. QA Lab manuel 0/15 : non effectué, ne pas considérer comme validé. Android, comparaison Figma finale, intégration et clôture restent ouverts.
