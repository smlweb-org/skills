# S—ML Web Profile 0.1 (Draft Specification)

*Status: draft for community review. This is the normative specification, maintained independently of the S—ML position paper. Header names, thresholds, and syntax are provisional. The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as described in RFC 2119.*

## A.1 Definitions

- **Resource** — the canonical logical content at a URL: identity, title, summary, primary content or state, and critical actions.
- **Representation** — a concrete delivery of a resource in a given profile.
- **Profile** — a named delivery weight with declared budgets. This specification defines three profile identifiers: `s`, `m`, `l`.
- **Critical actions** — the operations a user must be able to perform from the resource (e.g., check in, mark safe, confirm).
- **Hydration** — client-side enhancement of a lighter representation toward a heavier profile after initial delivery.

## A.2 Discovery

A server offering S—ML profiles SHOULD advertise them on every representation:

```
Available-Profiles: s, m, l
Content-Profile: m
```

An HTML representation SHOULD additionally declare alternates:

```html
<link rel="alternate" type="text/html" data-profile="s" href="?profile=s">
```

Servers MAY expose profiles via a `profile` query parameter as a fallback for clients that cannot set request headers. The canonical URL MUST be identical across profiles and declared via `rel="canonical"`.

## A.3 Negotiation

A client requests a profile with:

```
Accept-Profile: s
```

Rules:

1. A server that supports the requested profile MUST serve it and MUST declare it via `Content-Profile`.
2. A server that does not support the requested profile SHOULD serve the nearest **lighter** available profile, and MUST NOT silently serve a heavier one than requested.
3. A server serving profile-negotiated responses MUST include `Vary: Accept-Profile` so caches key correctly.
4. In the absence of `Accept-Profile`, a request carrying `Save-Data: on` SHOULD be treated as a request for `s`.
5. Negotiation MUST be driven by explicit client/user preference. Servers MUST NOT infer profiles from fingerprinting-adjacent signals (UA sniffing, IP-based network guessing) as the primary mechanism.

## A.4 The S representation (normative)

A representation served with `Content-Profile: s` MUST:

- contain the resource's canonical title, summary, primary content or current state, and critical actions in the initial response body;
- be usable without executing client-side JavaScript (JavaScript MAY be present within budget as enhancement — tree-shaken and profile-gated — but core content and critical actions MUST NOT depend on it);
- include no third-party scripts;
- be served over TLS end to end, with no intermediary transcoding gateway;
- include a machine-readable summary (meta description, JSON-LD, or equivalent structured block);
- declare its canonical URL.

It SHOULD: avoid custom fonts; keep images optional or heavily compressed; be cacheable; complete core delivery within its round-trip budget.

## A.5 Budgets (provisional)

| Requirement | s | m | l |
|---|---|---|---|
| Initial payload (HTML + render-blocking subresources) | ≤ 50 KB | ≤ 500 KB | open |
| Core content without JS | MUST | SHOULD | MAY |
| Third-party scripts | MUST NOT | ≤ 5 hosts | open |
| Custom fonts | SHOULD NOT | MAY | MAY |
| Round trips before core content | ≤ 2 | ≤ 5 | open |
| Machine-readable summary | MUST | SHOULD | SHOULD |
| End-to-end TLS | MUST | MUST | MUST |

Budget classes (`S-14`, `S-50`, `S-100`, `M-500`, `M-1000`) MAY be declared where a single threshold is too coarse; a declared class is auditable like any budget. `S-50` is the default Sparse class.

## A.6 Content equivalence

All profiles of a resource MUST agree on canonical title, summary, current state, and the set of critical actions. Heavier profiles MAY add content and capability; they MUST NOT contradict or omit the critical path present in `s`. A resource whose `s` representation cannot perform a critical action available in `l` is non-conforming.

## A.7 Hydration (informative)

The `s` representation MAY serve as the wire format from which `m` and `l` are hydrated client-side. Where hydration is used: core content MUST be complete and usable before any hydration begins; hydration MUST be interruptible without loss of content or entered state; and a client that has requested `s` MUST NOT be forced to hydrate past it.

## A.8 Conformance

A representation conforms to a profile if it meets every MUST and its budgets. Claims are made via `Content-Profile` and are auditable by tools (see `sml-audit`). Tools SHOULD report MUST violations as failures and SHOULD violations as warnings.

## A.9 Security and privacy considerations

S—ML introduces no intermediary: representations are origin-served over end-to-end TLS, unlike historical gateway-based mobile architectures. Profile negotiation adds one low-entropy request header; implementations MUST NOT extend it with device-identifying detail, and user agents SHOULD let users pin a profile preference globally (e.g., "always Sparse on metered links").
