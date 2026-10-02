// Provision iOS App Store signing assets via the App Store Connect API using the
// .p8 key, so EAS can build non-interactively with local credentials.
// Reads EXPO_ASC_KEY_ID / EXPO_ASC_ISSUER_ID / EXPO_ASC_API_KEY_PATH from env.
// Outputs credentials/cert.der and credentials/profile.mobileprovision, and
// prints the cert + bundle ids. No secrets are printed.
import fs from 'fs';
import crypto from 'crypto';

const KEY_ID = process.env.EXPO_ASC_KEY_ID;
const ISSUER = process.env.EXPO_ASC_ISSUER_ID;
const P8_PATH = process.env.EXPO_ASC_API_KEY_PATH.replace('$HOME', process.env.HOME);
const BUNDLE = 'com.skeptrune.backgammon';
const DIR = 'credentials';
const P8 = fs.readFileSync(P8_PATH, 'utf8');

function makeJwt() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input =
    b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }) +
    '.' +
    b64({ iss: ISSUER, iat: now, exp: now + 1000, aud: 'appstoreconnect-v1' });
  const sig = crypto.sign('sha256', Buffer.from(input), {
    key: crypto.createPrivateKey(P8),
    dsaEncoding: 'ieee-p1363',
  });
  return input + '.' + sig.toString('base64url');
}

const TOKEN = makeJwt();

async function api(method, path, body) {
  const res = await fetch('https://api.appstoreconnect.apple.com' + path, {
    method,
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    console.error(`API ${method} ${path} -> ${res.status}`);
    console.error(text.slice(0, 800));
    process.exit(1);
  }
  return json;
}

// 1) Distribution certificate from our CSR.
const csr = fs.readFileSync(`${DIR}/dist.csr`, 'utf8');
const cert = await api('POST', '/v1/certificates', {
  data: { type: 'certificates', attributes: { certificateType: 'IOS_DISTRIBUTION', csrContent: csr } },
});
const certId = cert.data.id;
fs.writeFileSync(`${DIR}/cert.der`, Buffer.from(cert.data.attributes.certificateContent, 'base64'));

// 2) Explicit App ID (bundle id), reuse if it already exists.
const existing = await api(
  'GET',
  `/v1/bundleIds?filter[identifier]=${encodeURIComponent(BUNDLE)}&limit=200`,
);
let bundleId = (existing.data || []).find((b) => b.attributes.identifier === BUNDLE)?.id;
if (!bundleId) {
  const created = await api('POST', '/v1/bundleIds', {
    data: { type: 'bundleIds', attributes: { identifier: BUNDLE, name: 'Backgammon', platform: 'IOS' } },
  });
  bundleId = created.data.id;
}

// 3) App Store provisioning profile linking the bundle id + cert (no devices needed).
const profName = `Backgammon AppStore ${Date.now()}`;
const profile = await api('POST', '/v1/profiles', {
  data: {
    type: 'profiles',
    attributes: { name: profName, profileType: 'IOS_APP_STORE' },
    relationships: {
      bundleId: { data: { type: 'bundleIds', id: bundleId } },
      certificates: { data: [{ type: 'certificates', id: certId }] },
    },
  },
});
fs.writeFileSync(
  `${DIR}/profile.mobileprovision`,
  Buffer.from(profile.data.attributes.profileContent, 'base64'),
);

console.log(JSON.stringify({ certId, bundleId, profName }));
