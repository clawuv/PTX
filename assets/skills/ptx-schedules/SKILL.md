---
name: ptx-schedules
description: Create, inspect, edit, pause, resume, run, and delete durable Ptx scheduled tasks. Use when the user asks to schedule recurring or one-time work in the current project or thread. Use rlm-heartbeat instead for temporary internal polling while actively working.
---

# Ptx Schedules

Use this capability for durable, user-visible tasks. Ptx must be running.

- `current_project`: each run creates a fresh top-level session in this project.
- `current_session`: each run returns to this thread and keeps its context.
- Use `rlm_heartbeat` instead for short-lived agent-internal checks such as watching a test command.

Call from IPython:

```python
await ptx_schedules.create_recurring(
    prompt="Review open issues and report blockers",
    rrule="FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0",
    dtstart_local="2026-08-07T09:00:00",
    time_zone="America/Los_Angeles",
    target="current_project",
    title="Morning issue review",
    model="auto",
    thinking="high",
    fast=False,
)
```

Other calls:

```python
await ptx_schedules.create_once(prompt="...", at="2026-08-08T18:00:00Z", target="current_session")
await ptx_schedules.list()
await ptx_schedules.update(task_id, title="New title", prompt="...")
await ptx_schedules.pause(task_id)
await ptx_schedules.resume(task_id)
await ptx_schedules.run_now(task_id)
await ptx_schedules.delete(task_id)
```

RRULE must be RFC 5545 without `DTSTART`; pass local start and IANA timezone separately. Never invent another project path or session ID: this capability is intentionally restricted to the current project/thread.
