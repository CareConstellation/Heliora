/**
 * Strict SVG sanitizer for user-supplied clinical artwork (lab charts, dental
 * diagrams and avatars).
 *
 * DOMPurify runs with an SVG-only profile (no HTML or MathML). Before it sees
 * the document, DTD/ENTITY declarations and custom entity references are
 * removed so XXE gadgets and entity-encoded payloads cannot survive, and a
 * hook drops event handlers, script/data URIs and CSS expressions.
 *
 * The same helpers also sanitize SVG data URLs so avatars and viewer images
 * cannot be used as a script delivery channel.
 */

import createDOMPurify, { type Config, type DOMPurify } from 'dompurify';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';

const DTD_DECLARATION = /<!\s*(?:DOCTYPE|ENTITY|ELEMENT|ATTLIST|NOTATION)\b[^>]*>/gi;
const DTD_TERMINATOR = /\]\s*>/g;
const CUSTOM_ENTITY =
  /&(?!amp;|lt;|gt;|quot;|apos;|nbsp;|#\d+;|#x[0-9a-f]+;)[A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?;/gi;
const CONTROL_WHITESPACE = /[\u0000-\u0020\u007F-\u009F\u200B-\u200F\uFEFF]/g;
const SCRIPT_SCHEME =
  /^(?:javascript|vbscript|livescript|mocha|data:text\/html|data:application\/javascript|data:image\/svg\+xml):/i;
const DANGEROUS_CSS = /(?:expression\s*\(|@import|behavior\s*:|url\s*\(\s*['"]?\s*(?:javascript|vbscript):)/i;
const EVENT_HANDLER = /\son[a-z]+\s*=/i;
const SCRIPT_OR_FOREIGN_OBJECT = /<\s*\/?\s*(?:script|foreignObject|handler)\b/i;

/** Accepts inert attribute values, safe schemes and raster data URIs only (DOMPurify checks every attribute value). */
const SAFE_URI_REGEXP =
  /^(?:(?:https?|mailto|tel):|data:image\/(?:png|jpe?g|gif|webp|avif);|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;

const SVG_CONFIG: Config = {
  USE_PROFILES: { svg: true, svgFilters: true },
  NAMESPACE: SVG_NAMESPACE,
  ALLOWED_NAMESPACES: [SVG_NAMESPACE, XLINK_NAMESPACE],
  ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
  FORBID_TAGS: [
    'script',
    'foreignObject',
    'handler',
    'iframe',
    'object',
    'embed',
    'link',
    'meta',
    'base',
    'style',
    'animate',
    'animateTransform',
    'set',
    'audio',
    'video',
  ],
  FORBID_CONTENTS: ['script', 'foreignObject', 'style', 'handler'],
  FORBID_ATTR: [
    'onload',
    'onerror',
    'onclick',
    'onbegin',
    'onend',
    'onmouseover',
    'onfocus',
    'onblur',
  ],
  KEEP_CONTENT: false,
  SANITIZE_DOM: true,
  RETURN_DOM: false,
};

const TEXT_CONFIG: Config = {
  USE_PROFILES: {},
  FORBID_TAGS: ['script', 'foreignObject', 'style', 'iframe', 'object', 'embed'],
  FORBID_CONTENTS: ['script', 'foreignObject', 'style'],
  KEEP_CONTENT: true,
  SANITIZE_DOM: true,
  RETURN_DOM: false,
};

/** Thrown for SVG content that cannot be made safe. */
export class UnsafeSvgError extends Error {
  constructor(readonly threats: string[]) {
    super(`Unsafe SVG rejected: ${threats.join('; ')}`);
    this.name = 'UnsafeSvgError';
  }
}

export interface SvgSanitizationResult {
  /** Sanitized, standalone SVG markup. */
  svg: string;
  /** Human-readable list of constructs that were removed. */
  removed: string[];
}

function compactScheme(value: string): string {
  return value.replace(CONTROL_WHITESPACE, '').toLowerCase();
}

function stripDeclarations(source: string, removed: string[]): string {
  let out = source;
  if (DTD_DECLARATION.test(out) || /\]\s*>/.test(out)) {
    out = out.replace(DTD_DECLARATION, '').replace(DTD_TERMINATOR, '');
    removed.push('external entity / DTD declarations (XXE)');
  }
  DTD_DECLARATION.lastIndex = 0;
  if (CUSTOM_ENTITY.test(out)) {
    out = out.replace(CUSTOM_ENTITY, '');
    removed.push('unresolved custom entity references');
  }
  CUSTOM_ENTITY.lastIndex = 0;
  return out;
}

function installUriHook(instance: DOMPurify): void {
  instance.addHook('uponSanitizeAttribute', (_node, data) => {
    const name = data.attrName.toLowerCase();
    const value = data.attrValue ?? '';
    if (name.startsWith('on')) {
      data.keepAttr = false;
      data.forceKeepAttr = false;
      return;
    }
    if (/^(?:href|xlink:href|src|action|formaction|data|filter|clip-path|fill|stroke)$/.test(name)) {
      const compact = compactScheme(value);
      if (SCRIPT_SCHEME.test(compact) || (compact.startsWith('data:') && !/^data:image\/(?:png|jpe?g|gif|webp|avif);/.test(compact))) {
        data.keepAttr = false;
        data.forceKeepAttr = false;
      }
    }
    if (name === 'style' && DANGEROUS_CSS.test(value)) {
      data.keepAttr = false;
      data.forceKeepAttr = false;
    }
  });
}

/**
 * DOMPurify needs a window. In Node/SSR there is none, so a hardened regex
 * pass is used as a fail-closed fallback; client-side code always re-checks
 * with the full DOMPurify profile.
 */
function getInstance(): DOMPurify | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const instance = createDOMPurify(window);
  installUriHook(instance);
  return instance;
}

let svgPurify: DOMPurify | null | undefined;
let textPurify: DOMPurify | null | undefined;

function purifier(kind: 'svg' | 'text'): DOMPurify | null {
  if (kind === 'svg') {
    if (svgPurify === undefined) svgPurify = getInstance();
    return svgPurify;
  }
  if (textPurify === undefined) textPurify = getInstance();
  return textPurify;
}

/** Removes active content without a DOM, used only when no window is available. */
function stripWithoutDom(source: string): string {
  return source
    .replace(/<\s*(?:script|foreignObject|handler)\b[^>]*>[\s\S]*?<\s*\/\s*(?:script|foreignObject|handler)\s*>/gi, '')
    .replace(/<\s*\/?\s*(?:script|foreignObject|handler|iframe|object|embed|style|animate|set)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:href|xlink:href|src|action|formaction|data|fill|stroke)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, (attr) =>
      SCRIPT_SCHEME.test(compactScheme(attr)) ? '' : attr,
    );
}

/**
 * Sanitizes an SVG document with a strict SVG/XML profile.
 * @throws {UnsafeSvgError} If the input is not SVG or is not a valid SVG document.
 */
export function sanitizeSvg(source: string): SvgSanitizationResult {
  if (typeof source !== 'string' || !/<\s*svg\b/i.test(source)) {
    throw new UnsafeSvgError(['content is not an SVG document']);
  }
  const removed: string[] = [];
  const stripped = stripDeclarations(source, removed);
  const instance = purifier('svg');
  const svg = instance
    ? String(instance.sanitize(stripped, SVG_CONFIG))
    : stripWithoutDom(stripped);
  const output = svg.trim();

  if (!/^<\s*svg\b/i.test(output) || !/(?:<\s*\/\s*svg\s*>|<\s*svg\b[^>]*\/>)$/i.test(output)) {
    throw new UnsafeSvgError(['SVG root element is missing or malformed']);
  }
  if (SCRIPT_OR_FOREIGN_OBJECT.test(output) || EVENT_HANDLER.test(output)) {
    throw new UnsafeSvgError(['active SVG content survived sanitization']);
  }
  if (SCRIPT_SCHEME.test(compactScheme(output))) {
    throw new UnsafeSvgError(['script pseudo-protocol survived sanitization']);
  }
  return { svg: output, removed };
}

/** Returns a data URL containing only sanitized SVG markup. */
export function sanitizeSvgDataUrl(source: string): string {
  const { svg } = sanitizeSvg(source);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function isSvgDataUrl(value: string): boolean {
  return /^data:image\/svg\+xml(?:[;,]|$)/i.test(value.trim());
}

function decodeSvgDataUrl(value: string): string {
  const comma = value.indexOf(',');
  if (comma === -1) throw new UnsafeSvgError(['malformed SVG data URL']);
  const meta = value.slice(0, comma).toLowerCase();
  const payload = value.slice(comma + 1);
  const decoded = meta.includes(';base64')
    ? typeof atob === 'function'
      ? atob(payload)
      : Buffer.from(payload, 'base64').toString('utf8')
    : decodeURIComponent(payload);
  return decoded;
}

/**
 * Sanitizes an image/source attribute. Non-SVG URLs are returned unchanged,
 * while `javascript:`/`vbscript:` URLs are replaced with an empty string.
 */
export function sanitizeImageSource(value: string): string {
  if (typeof value !== 'string') return '';
  const compact = compactScheme(value);
  if (SCRIPT_SCHEME.test(compact)) return '';
  if (!isSvgDataUrl(value)) return value;
  try {
    return sanitizeSvgDataUrl(decodeSvgDataUrl(value));
  } catch {
    return '';
  }
}

export function isSvgFile(file: File): boolean {
  return file.type === 'image/svg+xml' || /\.svgz?$/i.test(file.name);
}

/** Strips markup/script payloads from a plain-text clinical field. */
export function sanitizeText(value: string): string {
  if (typeof value !== 'string') return '';
  const instance = purifier('text');
  const cleaned = instance
    ? String(instance.sanitize(stripDeclarations(value, []), TEXT_CONFIG))
    : stripWithoutDom(stripDeclarations(value, []));
  return SCRIPT_SCHEME.test(compactScheme(cleaned)) ? '' : cleaned;
}

/** True when a plain-text field carries embedded SVG/HTML or script markup. */
export function containsMarkupPayload(value: string): boolean {
  if (typeof value !== 'string') return false;
  const stripped = stripDeclarations(value, []);
  return (
    /<\s*\/?\s*[a-z][\w:-]*\b[^>]*>/i.test(stripped) ||
    EVENT_HANDLER.test(stripped) ||
    SCRIPT_SCHEME.test(compactScheme(stripped))
  );
}
