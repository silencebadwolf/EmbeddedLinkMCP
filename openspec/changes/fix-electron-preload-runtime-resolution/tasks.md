## 1. Reproduce

- [x] 1.1 Add a failing regression test for a preload-shaped Electron API object.
- [x] 1.2 Confirm the test fails because `resolveElectronRuntime()` rejects the valid preload shape.

## 2. Fix

- [x] 2.1 Update the Electron runtime resolver to accept main-process and preload-process shapes.
- [x] 2.2 Keep rejecting the npm Electron wrapper executable path shape.

## 3. Verify

- [x] 3.1 Run the targeted Electron runtime test.
- [x] 3.2 Run OpenSpec validation for this change and all specs.
- [x] 3.3 Run the relevant build/test checks for the touched surface.
