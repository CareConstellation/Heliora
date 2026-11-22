import {
  containsMarkupPayload,
  isSvgDataUrl,
  sanitizeImageSource,
  sanitizeSvg,
  sanitizeText,
  UnsafeSvgError,
} from '@/lib/svgSanitizer';
import { validateRow } from '@/lib/bulkRecordParser';

const clean = (svg: string) => sanitizeSvg(svg).svg;

/** Malformed attack markup may be rejected outright instead of being rewritten. */
const neutralize = (svg: string): string | null => {
  try {
    return clean(svg);
  } catch (error) {
    if (error instanceof UnsafeSvgError) return null;
    throw error;
  }
};

describe('strict SVG/XMl profile', () => {
  it('keeps benign SVG artwork intact', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="blue"/></svg>';
    expect(clean(svg)).toContain('<circle');
    expect(clean(svg)).toContain('viewBox="0 0 10 10"');
  });

  it.each([
    ['<script>alert(1)</script>', '<svg><script>alert(1)</script><rect width="10" height="10"/></svg>'],
    ['<foreignObject>', '<svg><foreignObject><body onload="alert(1)">x</body></foreignObject></svg>'],
    ['onload', '<svg onload="alert(1)"><rect width="10" height="10" onload="alert(2)"/></svg>'],
    ['handler', '<svg><handler xmlns="http://www.w3.org/2000/svg" xlink:href="data:text/javascript,alert(1)"/></svg>'],
    ['animate', '<svg><animate attributeName="href" to="javascript:alert(1)"/><rect/></svg>'],
  ])('removes %s from SVG', (_label, payload) => {
    const output = neutralize(payload);
    if (output === null) return;
    expect(output).not.toMatch(/<script|foreignObject|onload|handler|<animate/i);
    expect(output).not.toMatch(/javascript:/i);
  });

  it('rejects an SVG document that has no root', () => {
    expect(() => sanitizeSvg('<div>not an svg</div>')).toThrow(UnsafeSvgError);
  });
});

describe('OWASP SVG XSS filter evasion vectors', () => {
  const vectors = [
    '<svg><script>alert(1)</script></svg>',
    '<svg/onload=alert(1)>',
    '<svg><g onload=alert(1)><rect width="10" height="10"/></g></svg>',
    '<svg><a xlink:href="javascript:alert(1)"><rect width="10" height="10"/></a></svg>',
    '<svg><a href="JaVaScRiPt:alert(1)">x</a></svg>',
    '<svg><a href="java&#x09;script:alert(1)">x</a></svg>',
    '<svg><image href="javascript:alert(1)"/></svg>',
    '<svg><use xlink:href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="/></svg>',
    '<svg><script xlink:href="data:text/javascript,alert(1)"/></svg>',
    '<svg><g><![CDATA[<img src=x onerror=alert(1)>]]></g></svg>',
    '<svg><desc>&lt;script&gt;alert(1)&lt;/script&gt;</desc><rect/></svg>',
    '<svg><style>@import "javascript:alert(1)";</style><rect/></svg>',
    '<svg><rect style="fill:url(javascript:alert(1))" width="10" height="10"/></svg>',
    '<svg><a href="&#106;avascript:alert(1)">x</a></svg>',
    '<svg><foreignObject><iframe src="javascript:alert(1)"/></foreignObject></svg>',
    '<svg><set attributeName="onbegin" to="alert(1)"/><rect/></svg>',
  ];

  it.each(vectors)('neutralizes %s', (vector) => {
    const output = neutralize(vector);
    if (output === null) return;
    expect(output).not.toMatch(/<script|foreignObject|onload|onerror|onbegin|<iframe|<style|<set/i);
    expect(output).not.toMatch(/javascript:|vbscript:|data:text\/html|data:text\/javascript/i);
  });
});

describe('XXE / entity hardening', () => {
  const xxe =
    '<!DOCTYPE svg [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>' +
    '<svg xmlns="http://www.w3.org/2000/svg"><text>&xxe;</text></svg>';

  it('strips DTD declarations and unresolved custom entities', () => {
    const result = sanitizeSvg(xxe);
    expect(result.removed).toEqual(expect.arrayContaining(['external entity / DTD declarations (XXE)']));
    expect(result.svg).not.toMatch(/<!DOCTYPE|<!ENTITY|SYSTEM|file:\/\//i);
    expect(result.svg).not.toContain('&xxe;');
    expect(result.svg).toContain('<svg');
  });

  it('preserves standard XML entities', () => {
    expect(clean('<svg><text>&lt;safe&gt; &amp; ok</text></svg>')).toMatch(/&lt;safe&gt;|&amp;/);
  });
});

describe('image source helper', () => {
  it('detects and sanitizes inline SVG data URLs', () => {
    const payload = encodeURIComponent('<svg onload="alert(1)"><script>alert(2)</script><rect/></svg>');
    const src = `data:image/svg+xml;charset=utf-8,${payload}`;
    expect(isSvgDataUrl(src)).toBe(true);
    const sanitized = sanitizeImageSource(src);
    expect(isSvgDataUrl(sanitized)).toBe(true);
    expect(sanitized).not.toMatch(/onload|%3Cscript|alert/i);
  });

  it('sanitizes base64-encoded SVG data URLs', () => {
    const src = `data:image/svg+xml;base64,${Buffer.from('<svg><script>alert(1)</script><rect/></svg>').toString('base64')}`;
    const sanitized = sanitizeImageSource(src);
    expect(sanitized).not.toMatch(/script|alert/i);
    expect(decodeURIComponent(sanitized)).toContain('<rect');
  });

  it('rejects script pseudo-protocols and malformed SVG', () => {
    expect(sanitizeImageSource('javascript:alert(1)')).toBe('');
    expect(sanitizeImageSource('data:image/svg+xml;base64,%%%')).toBe('');
    expect(sanitizeImageSource('https://example.org/avatar.png')).toBe(
      'https://example.org/avatar.png',
    );
  });
});

describe('bulk record text sanitization (#175)', () => {
  it('flags embedded SVG/script payloads during row validation', () => {
    const row = validateRow(
      {
        date: '2024-01-01',
        doctorName: 'Dr A',
        diagnosis: '<svg onload="alert(1)">Flu</svg>',
      },
      0,
    );
    expect(row._valid).toBe(false);
    expect(row._errors).toContain('Embedded SVG/HTML payload in diagnosis');
  });

  it('strips markup from free-text fields', () => {
    expect(sanitizeText('Flu <script>alert(1)</script><svg onload="alert(2)">x</svg>')).toBe('Flu x');
    expect(sanitizeText('Routine checkup')).toBe('Routine checkup');
  });

  it('detects markup payloads without flagging ordinary clinical text', () => {
    expect(containsMarkupPayload('<svg><rect/></svg>')).toBe(true);
    expect(containsMarkupPayload('Patient reports flu-like symptoms (A-type)')).toBe(false);
  });
});
