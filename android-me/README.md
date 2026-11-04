# Me (Android app)

A thin Trusted Web Activity around https://me.q08.org/companion. It adds no logic of its own: the companion stays on Cloudflare
(personal-api), and Chrome supplies on-device speech recognition, the camera and Web Push inside the app.

- Build: `.github/workflows/build-me-apk.yml` (push to this folder, or manual run) builds `app-debug.apk` and attaches it as the
  `me-companion-apk` artifact. Install it on the phone (allow "install unknown apps" once).
- Debug-signed on purpose: a release keystore is the owner's signing identity and is never minted by a session. Until Digital Asset
  Links are published for a release key, Chrome shows a slim address bar above the app; the companion itself is unchanged.
