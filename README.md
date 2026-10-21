# V1.7.1 Speed Run — deployment delta

Each file in this directory is **byte-identical** to the corresponding `REPO/` path. Use `REPO/` for complete GitHub deployment; `UPDATED_FILES` is reference-only for a source diff against V1.6.4.5.

Added `js/speed-run.js`; implemented the second mode tile, difficulty, lives and monotonic deadline, streaming prefetch, neutral timeout feedback, and mode-aware result/replay. The Classic mode and Admin/SQL remain unchanged in semantics. `ROADMAP.md` now documents forward-looking tasks only; `CHANGELOG.md` retains cumulative history.

Local Node test/build PASS and mocked browser exercise PASS. **Real-phone Safari/production deployment are still pending.** Theme snapshot/3D card risk inherited from V1.6.4.5 remains open.
