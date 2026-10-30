# Root fixes

A fix changes the design that let the defect happen: the module that owns the decision, the function every surface should call, the fake that hid it. Prefer that over a guard or special case at the symptom site.

- When reviewing a fix, name the root cause and check that the diff changes it.
- When the root fix is out of scope, the diff says so and records the root as an open point on the ticket.
