# BUG-1 - captured evidence

**Claim:** GET /api/agent/suggestions-unauthenticated serves enabled unauthenticated suggestions; the page renders none of them as selectable controls.

- Captured: 2026-08-15T01:52:54.326Z
- Test: verify-suggestions.spec.ts > clean-context suggestion render check
- Project: 
- URL: https://ask.permission.ai/

## Expected on the page

- `What is Permission`
- `Best way to earn ASK`
- `How permission uses my data`
- `What is passive earning`
- `What is data ownership`
- `Permission Wallet`

## Observed

| viewport | in visible text | in raw HTML | `Log in` present | authenticated widgets | screenshot |
|---|---|---|---|---|---|
| 1440x900 | 0/6 | 0/6 | yes | 0 | `artifacts/bug-evidence/bug-1-1440x900.png` |

Raw HTML is checked as well as visible text: a 0 there means the markup was
never rendered, not merely hidden by CSS. `Log in` present with zero
authenticated widgets is the proof that this capture is the anonymous state.

## Controls the page did render

- **1440x900**: `Log in`, `Sign Up`, `Permission.ai`, `Terms of Use`, `Privacy Policy`, `Permission Home |`, `Privacy Policy |`, `Terms of Use |`, `Support`, `Cookies Button`, `Privacy Policy`, `Accept All`, `Reject All`, `Manage Settings`, `More information`, `Back Button`, `Filter Button`, `Clear`, `Apply`, `Cancel`, `Confirm My Choices`, `Reject All`, `Allow All`

## What the backend served

```json
[
  {
    "id": "33255586-5631-40b4-9bc3-4959850361c0",
    "title": "What is Permission",
    "prompt": "What is Permission?",
    "for_authenticated": false,
    "order": 1,
    "enabled": true,
    "created_at": "2025-11-14T09:55:37.605Z",
    "updated_at": "2025-11-14T09:55:37.605Z"
  },
  {
    "id": "24dc3a2a-e9a0-4551-ac47-db35d222048c",
    "title": "Best way to earn ASK",
    "prompt": "How can i earn ASK?",
    "for_authenticated": false,
    "order": 2,
    "enabled": true,
    "created_at": "2025-11-14T09:55:58.811Z",
    "updated_at": "2025-11-14T09:55:58.811Z"
  },
  {
    "id": "ad19830a-2359-4c7e-9ca2-9a78a7ff4f3c",
    "title": "How permission uses my data",
    "prompt": "How permission uses my data?",
    "for_authenticated": false,
    "order": 3,
    "enabled": true,
    "created_at": "2025-11-14T09:56:14.815Z",
    "updated_at": "2025-11-14T09:56:14.815Z"
  },
  {
    "id": "620779ae-9f97-4e30-b85e-9c1564b08c0c",
    "title": "What is passive earning",
    "prompt": "What is passive earning?",
    "for_authenticated": false,
    "order": 4,
    "enabled": true,
    "created_at": "2025-11-14T09:56:40.951Z",
    "updated_at": "2025-11-14T09:56:40.951Z"
  },
  {
    "id": "4a7aa46e-9131-4937-9a09-a6dd6937bc51",
    "title": "What is data ownership",
    "prompt": "What is data ownership and why it is important for me?",
    "for_authenticated": false,
    "order": 5,
    "enabled": true,
    "created_at": "2025-11-14T09:59:27.185Z",
    "updated_at": "2025-11-14T09:59:27.185Z"
  },
  {
    "id": "6754e5cb-f6b2-4f32-9fdc-0fecc5011238",
    "title": "Permission Wallet",
    "prompt": "What is Permission Wallet?",
    "for_authenticated": false,
    "order": 6,
    "enabled": true,
    "created_at": "2025-11-14T10:00:34.903Z",
    "updated_at": "2025-11-14T10:00:34.903Z"
  }
]
```
