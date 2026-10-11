import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';

const flagUserPresent = 0x01;
const flagUserVerified = 0x04;
const flagAttested = 0x40;

/** What a browser puts in the client data, and where the test pretends it is. */
type Context = { origin: string; rpId?: string };

/** Switches that make the authenticator misbehave in one specific way. */
type Behaviour = {
  /** Report "user verified" (Face ID passed); false models a bare tap. */
  userVerified?: boolean;
  /** Use this signature counter instead of the next number. */
  counter?: number;
};

function sha256(data: Uint8Array | string): Buffer {
  return createHash('sha256').update(data).digest();
}

function counterBytes(counter: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(counter);
  return bytes;
}

/**
 * A software WebAuthn authenticator for tests: one ES256 credential, "none"
 * attestation, and a signature counter. It builds the same JSON a browser
 * hands to the server after `navigator.credentials.create()` and `get()`, so
 * the server's verification runs for real.
 */
export class SoftwareAuthenticator {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly publicJwk: { x: string; y: string };
  private counter = 0;

  constructor(private readonly rpId: string) {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = pair.privateKey;
    this.publicJwk = pair.publicKey.export({ format: 'jwk' }) as {
      x: string;
      y: string;
    };
  }

  /** The credential ID as the browser sends it (base64url). */
  get id(): string {
    return isoBase64URL.fromBuffer(this.credentialId);
  }

  /** Answers a registration ceremony with a new credential. */
  create(
    options: { challenge: string },
    context: Context,
    behaviour: Behaviour = {},
  ) {
    const coseKey = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, isoBase64URL.toBuffer(this.publicJwk.x)],
        [-3, isoBase64URL.toBuffer(this.publicJwk.y)],
      ]),
    );
    this.counter = behaviour.counter ?? this.counter;
    const credentialIdLength = Buffer.alloc(2);
    credentialIdLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(context.rpId ?? this.rpId),
      Buffer.from([this.flags(behaviour, flagAttested)]),
      counterBytes(this.counter),
      Buffer.alloc(16),
      credentialIdLength,
      this.credentialId,
      Buffer.from(coseKey),
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Uint8Array | Map<string, string>>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: this.clientData('webauthn.create', options, context),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        transports: ['internal'],
      },
    };
  }

  /** Answers an authentication ceremony by signing the challenge. */
  get(
    options: { challenge: string },
    context: Context,
    behaviour: Behaviour = {},
  ) {
    this.counter = behaviour.counter ?? this.counter + 1;
    const authData = Buffer.concat([
      sha256(context.rpId ?? this.rpId),
      Buffer.from([this.flags(behaviour, 0)]),
      counterBytes(this.counter),
    ]);
    const clientDataJSON = this.clientData('webauthn.get', options, context);
    const signature = sign(
      'sha256',
      Buffer.concat([authData, sha256(isoBase64URL.toBuffer(clientDataJSON))]),
      this.privateKey,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON,
        authenticatorData: isoBase64URL.fromBuffer(authData),
        signature: isoBase64URL.fromBuffer(signature),
      },
    };
  }

  private flags(behaviour: Behaviour, extra: number): number {
    return (
      flagUserPresent |
      extra |
      (behaviour.userVerified === false ? 0 : flagUserVerified)
    );
  }

  private clientData(
    type: 'webauthn.create' | 'webauthn.get',
    options: { challenge: string },
    context: Context,
  ): string {
    return Buffer.from(
      JSON.stringify({
        type,
        challenge: options.challenge,
        origin: context.origin,
        crossOrigin: false,
      }),
    ).toString('base64url');
  }
}
