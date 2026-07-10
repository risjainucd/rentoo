// Verify a Cloudflare Access JWT (RS256) against the team's JWKS.
// Access sits in front of /admin and injects `Cf-Access-Jwt-Assertion`; we verify
// it here so the Worker never trusts an unsigned header. Fail closed everywhere.

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }

let jwksCache: { keys: Jwk[]; exp: number } | null = null;

async function getJwks(teamDomain: string): Promise<Jwk[]> {
  const now = Date.now();
  if (jwksCache && jwksCache.exp > now) return jwksCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`JWKS fetch ${res.status}`);
  const data = (await res.json()) as { keys: Jwk[] };
  jwksCache = { keys: data.keys ?? [], exp: now + 3_600_000 }; // cache 1h
  return jwksCache.keys;
}

function b64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function decodeJson(part: string): any {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
}

export interface AccessClaims { email?: string; sub?: string }

// Returns the verified claims, or null if the token is missing/invalid/expired.
export async function verifyAccessJwt(
  token: string,
  teamDomain: string,
  aud: string,
): Promise<AccessClaims | null> {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const header = decodeJson(h);
    const payload = decodeJson(p);

    // Claims checks
    const audOk = Array.isArray(payload.aud) ? payload.aud.includes(aud) : payload.aud === aud;
    if (!audOk) return null;
    if (payload.iss && payload.iss !== `https://${teamDomain}`) return null;
    if (payload.exp && Math.floor(Date.now() / 1000) >= payload.exp) return null;

    // Signature check
    const jwk = (await getJwks(teamDomain)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(s) as unknown as BufferSource,
      new TextEncoder().encode(`${h}.${p}`) as unknown as BufferSource,
    );
    if (!ok) return null;

    return { email: payload.email, sub: payload.sub };
  } catch {
    return null;
  }
}
