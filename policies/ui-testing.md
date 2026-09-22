# UI testing

Test the decision, not the drawing: store transitions, computed presentation,
and the modules that decide what entries exist, what state applies, and why a
control is blocked.

- happy-dom supplies DOM globals. A mounted tree proves wiring — store
  reactions, event flow, conditional branches — not the visual output of a
  real host.
- Visual correctness (CSS, layout, focus, host menus) is proved in the running
  app, not a test runner.
