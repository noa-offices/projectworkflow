Fix the Settings sidebar submenu so all permitted Settings items remain visible consistently on every Settings-related route.

IMPORTANT: Minimise Codex credit usage and make the smallest targeted navigation-only change.

## Current issue

The Settings submenu works correctly on some routes such as:

`/hr`

On `/hr`, the System Owner sees all permitted Settings children:

- Company Profile
- Document Defaults
- My Profile
- User Management
- HR Management
- Worker Directory
- Role Guide
- Commission Settings

However, after navigating from the sidebar to routes such as:

- `/settings/profile`
- `/settings/users`
- `/settings/workers`

some other Settings submenu items disappear.

The same signed-in System Owner should see the same permitted Settings child links on every Settings-related page.

Only the active child should change.

## Expected behaviour

For the same user and role, the Settings submenu must remain stable across all related routes.

Example for System Owner:

```text
Settings
  Company Profile
  Document Defaults
  My Profile
  User Management
  HR Management
  Worker Directory
  Role Guide
  Commission Settings