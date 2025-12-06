# Future & Research

Forward-looking notes without sensitive detail.

## Themes
- Expanded sampler windows and adaptive buffering.
- Additional health/audit surfacing for users and admins.
- UX exploration: clearer cues for warm-up states, invite status, and data freshness.
- More granular universe controls (per-quote, per-market filters).

## Research notes (for devs)
- Investigate lightweight anomaly detection on id_pct deltas using simple thresholds (avoid heavy ML).
- Explore caching strategies for upstream market APIs to reduce burst pressure.
- Consider user-level feature flags for experimental UI components.

## Contribution guidance
- Keep experiments opt-in and isolated.
- Document math plainly; avoid opaque models.
- Avoid schema or role names in public docs; describe behavior only.
