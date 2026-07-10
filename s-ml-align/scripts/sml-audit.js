#!/usr/bin/env node
/**
 * sml-audit — conformance auditor for S—ML Web delivery profiles.
 *
 * S—ML Web: Responsive Delivery Profiles for the Open Web.
 * One URL. Three weights. No separate internet.
 *
 * Zero dependencies. Node >= 18.
 *
 * Usage:
 *   sml-audit <url> [--profile=s|m|l|all] [--json] [--no-color] [--max-fetch=N]
 *
 * Exit codes: 0 = requested profile(s) pass, 1 = failure, 2 = error.
 */

'use strict';

// ---------------------------------------------------------------- budgets

const BUDGETS = {
  s: {
    label: 'S — Sparse',
    initialPayload: 50 * 1024,
    coreWithoutJs: 'required',
    thirdPartyScripts: 0,
    customFonts: false,
    roundTrips: 2,
    machineSummary: 'required',
  },
  m: {
    label: 'M — Medium',
    initialPayload: 1024 * 1024,
    coreWithoutJs: 'recommended',
    thirdPartyScripts: 5,
    customFonts: true,
    roundTrips: 5,
    machineSummary: 'recommended',
  },
  l: {
    label: 'L — Luxe',
    initialPayload: Infinity,
    coreWithoutJs: 'optional',
    thirdPartyScripts: Infinity,
    customFonts: true,
    roundTrips: Infinity,
    machineSummary: 'recommended',
  },
};

// ---------------------------------------------------------------- cli args

function parseArgs(argv) {
  const args = { profile: 'all', json: false, color: true, maxFetch: 15, url: null };
  for (const a of argv) {
    if (a.startsWith('--profile=')) args.profile = a.slice(10).toLowerCase();
    else if (a === '--json') args.json = true;
    else if (a === '--no-color') args.color = false;
    else if (a.startsWith('--max-fetch=')) args.maxFetch = parseInt(a.slice(12), 10) || 15;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (!a.startsWith('-')) args.url = a;
  }
  return args;
}

const HELP = `sml-audit — S—ML Web profile conformance auditor

Usage:
  sml-audit <url> [options]

Options:
  --profile=s|m|l|all   Profile to grade against (default: all)
  --json                Machine-readable JSON output
  --no-color            Disable ANSI colors
  --max-fetch=N         Max render-blocking subresources to fetch (default: 15)
`;

// ---------------------------------------------------------------- helpers

function kb(bytes) {
  return bytes === Infinity ? 'open' : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

function color(enabled) {
  const wrap = (c) => (s) => (enabled ? `\x1b[${c}m${s}\x1b[0m` : String(s));
  return { red: wrap(31), green: wrap(32), yellow: wrap(33), dim: wrap(2), bold: wrap(1) };
}

async function fetchBytes(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'sml-audit/0.4 (+https://github.com/smlweb-org/sml-audit)', ...headers },
    redirect: 'follow',
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { res, buf, bytes: buf.byteLength };
}

// ---------------------------------------------------------------- html analysis

function stripBlocks(html, tag) {
  return html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'gi'), ' ');
}

function visibleText(html) {
  let t = stripBlocks(stripBlocks(html, 'script'), 'style');
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/&[a-z#0-9]+;/gi, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

function attrs(tag) {
  const out = {};
  const re = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  return out;
}

function analyze(html, baseUrl) {
  const base = new URL(baseUrl);
  const a = {
    scripts: { inline: 0, external: [], blocking: [], thirdParty: [] },
    stylesheets: [],
    fonts: [],
    images: 0,
    text: visibleText(html),
    emptyAppRoot: false,
    meta: {},
    profiles: { declared: [], links: [] },
  };

  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    const at = attrs(m[0]);
    if (at.type === 'application/ld+json') { a.meta.jsonLd = true; continue; }
    if (!at.src) { a.scripts.inline++; continue; }
    let u; try { u = new URL(at.src, base); } catch { continue; }
    a.scripts.external.push(u.href);
    if (!('defer' in at) && !('async' in at) && at.type !== 'module') a.scripts.blocking.push(u.href);
    if (u.host !== base.host) a.scripts.thirdParty.push(u.host);
  }

  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const at = attrs(m[0]);
    const rel = (at.rel || '').toLowerCase();
    let u = null; try { u = at.href ? new URL(at.href, base) : null; } catch {}
    if (rel === 'stylesheet' && u) a.stylesheets.push(u.href);
    if ((rel === 'preload' && at.as === 'font') || (u && /fonts\.(googleapis|gstatic)\.com|use\.typekit/.test(u.host))) a.fonts.push(u ? u.href : 'font');
    if (rel === 'canonical' && u) a.meta.canonical = u.href;
    if (rel === 'alternate' && at['data-profile']) a.profiles.links.push(at['data-profile']);
  }
  if (/@font-face/i.test(html)) a.fonts.push('@font-face (inline)');

  a.images = (html.match(/<img\b/gi) || []).length;

  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) a.meta.title = t[1].trim();
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const at = attrs(m[0]);
    if ((at.name || '').toLowerCase() === 'description' || (at.property || '') === 'og:description') {
      a.meta.description = at.content;
    }
  }

  // Empty app-root heuristic: SPA shell that is meaningless without JS.
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];
  const roots = body.match(/<div[^>]*id\s*=\s*["'](root|app|__next|___gatsby|main)["'][^>]*>\s*<\/div>/i);
  a.emptyAppRoot = Boolean(roots);

  return a;
}

// ---------------------------------------------------------------- audit

async function audit(urlStr, opts) {
  const start = Date.now();
  const { res, buf, bytes } = await fetchBytes(urlStr, { 'accept-profile': opts.profile === 'all' ? 's' : opts.profile });
  const finalUrl = res.url || urlStr;
  const html = buf.toString('utf8');
  const an = analyze(html, finalUrl);

  // Headers-based profile discovery (future negotiation).
  const contentProfile = res.headers.get('content-profile');
  const availableProfiles = res.headers.get('available-profiles');
  if (availableProfiles) an.profiles.declared = availableProfiles.split(',').map((s) => s.trim());

  // Initial payload = HTML + render-blocking CSS + render-blocking JS.
  let subBytes = 0;
  const toFetch = [...an.stylesheets, ...an.scripts.blocking].slice(0, opts.maxFetch);
  const fetched = [];
  for (const u of toFetch) {
    try {
      const r = await fetchBytes(u);
      subBytes += r.bytes;
      fetched.push({ url: u, bytes: r.bytes });
    } catch { fetched.push({ url: u, bytes: 0, error: true }); }
  }
  const initialPayload = bytes + subBytes;

  // Crude round-trip estimate: HTML, then one wave of render-blocking
  // resources, then one more if blocking resources live on other origins
  // (new connections) or fonts are render-relevant.
  const pageHost = new URL(finalUrl).host;
  const crossOriginBlocking = toFetch.some((u) => { try { return new URL(u).host !== pageHost; } catch { return false; } });
  let roundTrips = 1;
  if (toFetch.length > 0) roundTrips++;
  if (crossOriginBlocking || an.fonts.length > 0) roundTrips++;

  // JS-required heuristic.
  const jsRequired = an.emptyAppRoot || (an.text.length < 200 && an.scripts.external.length > 0);

  const facts = {
    url: finalUrl,
    // localhost counts as a secure context, matching browser behavior.
    https: finalUrl.startsWith('https:') || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(finalUrl).hostname),
    status: res.status,
    htmlBytes: bytes,
    renderBlocking: fetched,
    initialPayload,
    roundTrips,
    jsRequired,
    emptyAppRoot: an.emptyAppRoot,
    visibleTextChars: an.text.length,
    scripts: {
      external: an.scripts.external.length,
      blocking: an.scripts.blocking.length,
      inline: an.scripts.inline,
      thirdPartyHosts: [...new Set(an.scripts.thirdParty)],
    },
    stylesheets: an.stylesheets.length,
    customFonts: an.fonts.length > 0,
    images: an.images,
    machineSummary: Boolean(an.meta.description || an.meta.jsonLd),
    canonical: an.meta.canonical || null,
    profileDiscovery: {
      contentProfile: contentProfile || null,
      availableProfiles: an.profiles.declared,
      alternateLinks: an.profiles.links,
    },
    elapsedMs: Date.now() - start,
  };

  return { facts, grades: gradeAll(facts) };
}

function gradeAll(f) {
  const grades = {};
  for (const [key, b] of Object.entries(BUDGETS)) {
    const fails = [];
    const warns = [];
    // Spec A.5: normative budgets exist only for `s`. Medium deviations are
    // advisories (warnings), Luxe is unconstrained. TLS binds every profile.
    const strict = key === 's';
    const flag = (msg) => (strict ? fails : warns).push(msg);

    if (!f.https) fails.push('Not served over HTTPS (end-to-end TLS required for every profile)');

    if (f.initialPayload > b.initialPayload) {
      flag(`Initial payload ${kb(f.initialPayload)} exceeds ${strict ? 'budget' : 'recommended'} ${kb(b.initialPayload)}`);
    }
    if (f.jsRequired) {
      const msg = f.emptyAppRoot
        ? 'Core content unavailable without JavaScript (empty application shell)'
        : 'Core content likely unavailable without JavaScript (little visible text, external scripts present)';
      if (b.coreWithoutJs === 'required') flag(msg);
      else if (b.coreWithoutJs === 'recommended') warns.push(msg);
    }
    const tp = f.scripts.thirdPartyHosts.length;
    if (tp > b.thirdPartyScripts) {
      flag(`${tp} third-party script host(s) (${f.scripts.thirdPartyHosts.join(', ')}), ${strict ? 'budget' : 'recommended'}: ${b.thirdPartyScripts === 0 ? 'none' : b.thirdPartyScripts}`);
    }
    if (f.customFonts && !b.customFonts) flag('Custom fonts present (avoid for this profile)');
    if (f.roundTrips > b.roundTrips) {
      flag(`Estimated ${f.roundTrips} round trips before core content, ${strict ? 'budget' : 'recommended'}: ${b.roundTrips}`);
    }
    if (!f.machineSummary) {
      const msg = 'Missing machine-readable summary (meta description or JSON-LD)';
      if (b.machineSummary === 'required') fails.push(msg);
      else warns.push(msg);
    }

    grades[key] = { label: b.label, pass: fails.length === 0, fails, warns };
  }
  return grades;
}

// ---------------------------------------------------------------- report

function report(result, opts) {
  const c = color(opts.color && process.stdout.isTTY !== false);
  const { facts, grades } = result;
  const lines = [];

  lines.push(c.bold(`\nS—ML Audit: ${facts.url}`));
  lines.push(c.dim(`HTML ${kb(facts.htmlBytes)} + ${facts.renderBlocking.length} render-blocking resource(s) → initial payload ${kb(facts.initialPayload)}`));
  lines.push(c.dim(`~${facts.roundTrips} round trip(s) · ${facts.scripts.external} external / ${facts.scripts.blocking} blocking script(s) · ${facts.stylesheets} stylesheet(s) · fonts: ${facts.customFonts ? 'yes' : 'no'} · visible text: ${facts.visibleTextChars} chars`));

  const disc = facts.profileDiscovery;
  if (disc.contentProfile || disc.availableProfiles.length || disc.alternateLinks.length) {
    lines.push(c.dim(`Profile discovery: content-profile=${disc.contentProfile || '—'} available=[${disc.availableProfiles.join(', ') || disc.alternateLinks.join(', ') || '—'}]`));
  } else {
    lines.push(c.dim('Profile discovery: none declared (no Available-Profiles header or alternate links)'));
  }
  lines.push('');

  const wanted = opts.profile === 'all' ? ['s', 'm', 'l'] : [opts.profile];
  let allPass = true;
  for (const p of wanted) {
    const g = grades[p];
    if (!g) continue;
    const badge = g.pass ? c.green('PASS') : c.red('FAIL');
    lines.push(`${c.bold(g.label.padEnd(12))} ${badge}`);
    for (const fmsg of g.fails) lines.push(`  ${c.red('✗')} ${fmsg}`);
    for (const w of g.warns) lines.push(`  ${c.yellow('!')} ${w}`);
    if (!g.pass) allPass = false;
    lines.push('');
  }

  lines.push(c.dim(`Audited in ${facts.elapsedMs} ms · sml-audit 0.4 (prototype: static analysis, no headless browser)`));
  return { text: lines.join('\n'), allPass };
}

// ---------------------------------------------------------------- main

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.url) { console.log(HELP); process.exit(opts.help ? 0 : 2); }
  if (!['s', 'm', 'l', 'all'].includes(opts.profile)) {
    console.error(`Unknown profile "${opts.profile}" — use s, m, l, or all.`);
    process.exit(2);
  }
  if (!/^https?:\/\//.test(opts.url)) opts.url = 'https://' + opts.url;

  try {
    const result = await audit(opts.url, opts);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(Object.values(result.grades).every((g) => g.pass) ? 0 : 1);
    }
    const { text, allPass } = report(result, opts);
    console.log(text);
    process.exit(allPass ? 0 : 1);
  } catch (err) {
    console.error(`sml-audit: ${err.message}`);
    process.exit(2);
  }
})();
