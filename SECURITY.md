# Security Policy

SliceReady runs entirely in the browser — no backend, no accounts, nothing is
uploaded. The attack surface is client-side: mesh parsing, the ADMesh WASM
module, and the build pipeline.

## Reporting a vulnerability

Please report security issues **privately**, not as a public issue:

- Open a private [GitHub Security Advisory](https://github.com/fjfontanez/sliceready/security/advisories/new).

We aim to acknowledge reports within 7 days.

## Scope

- **In scope:** the web app, the repair engine and its WASM module, the build pipeline.
- **Out of scope:** the hosting platform itself — report those to the provider.
