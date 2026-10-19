import {
  AuthError,
  assertAllowedDomain,
  type AuthAdapter,
  type AuthClaims,
  type CompleteLoginParams,
  type StartLoginResult,
} from '@protocols/auth-core';
import { normalizeEmail } from '@protocols/domain';

/**
 * Development-only auth adapter.
 *
 * It never talks to a real IdP. It renders a persona picker, and the chosen
 * persona's email is carried through the callback. The web app refuses to
 * start when this adapter is selected with NODE_ENV=production
 * (docs/ict-sso/identity-integration.md).
 */

export interface MockPersona {
  key: string;
  email: string;
  displayLabel: string;
  /** Whether the seed/config allowlist should treat this persona as an admin. */
  admin: boolean;
}

export const DEFAULT_MOCK_PERSONAS: MockPersona[] = [
  { key: 'researcher', email: 'mock.researcher@ic.ac.uk', displayLabel: 'MOCK Researcher', admin: false },
  { key: 'researcher2', email: 'mock.colleague@ic.ac.uk', displayLabel: 'MOCK Second Researcher', admin: false },
  { key: 'admin', email: 'mock.admin@ic.ac.uk', displayLabel: 'MOCK Lab Admin', admin: true },
];

export interface MockAdapterOptions {
  personas?: MockPersona[];
  allowedDomains?: string[];
  /** Allows signing in as an arbitrary typed email during development. */
  allowArbitraryEmail?: boolean;
}

export class MockAuthAdapter implements AuthAdapter {
  readonly id = 'mock' as const;
  readonly isMock = true;
  readonly displayName = 'Mock sign-in (development only)';

  readonly personas: MockPersona[];
  private readonly allowedDomains: string[];
  private readonly allowArbitraryEmail: boolean;

  constructor(options: MockAdapterOptions = {}) {
    this.personas = options.personas ?? DEFAULT_MOCK_PERSONAS;
    this.allowedDomains = options.allowedDomains ?? [];
    this.allowArbitraryEmail = options.allowArbitraryEmail ?? true;
  }

  async startLogin(params: { returnTo: string; callbackUrl: string }): Promise<StartLoginResult> {
    // Send the browser to the in-app persona picker rather than to an IdP.
    const url = new URL('./mock', params.callbackUrl);
    url.searchParams.set('returnTo', params.returnTo);
    return { redirectUrl: url.toString(), transaction: { returnTo: params.returnTo } };
  }

  async completeLogin(params: CompleteLoginParams): Promise<AuthClaims> {
    const url = new URL(params.requestUrl);
    const email = params.body?.email ?? url.searchParams.get('email') ?? '';
    const personaKey = params.body?.persona ?? url.searchParams.get('persona') ?? '';

    const persona = this.personas.find((p) => p.key === personaKey);
    const chosenEmail = persona ? persona.email : normalizeEmail(email);

    if (!chosenEmail || !chosenEmail.includes('@')) {
      throw new AuthError('mock_no_persona', 'Choose a mock persona or enter a mock email address.');
    }
    if (!persona && !this.allowArbitraryEmail) {
      throw new AuthError('mock_persona_required', 'Only preconfigured mock personas may sign in.');
    }
    assertAllowedDomain(chosenEmail, this.allowedDomains);

    return {
      email: chosenEmail,
      subject: `mock:${chosenEmail}`,
      issuer: 'mock-auth-adapter',
      displayLabel: persona ? persona.displayLabel : `MOCK ${chosenEmail}`,
      logoutHint: null,
    };
  }

  async logoutUrl(): Promise<string | null> {
    return null;
  }
}
