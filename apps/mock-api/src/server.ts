#!/usr/bin/env node
/**
 * Development-only mock API.
 *
 * The web app talks to PostgreSQL directly through @protocols/db, so this
 * service is NOT on the request path for the UI. It exists for the case the
 * scaffold was written for: building and testing clients (scripts, notebooks,
 * a future mobile or CLI client) against a stable JSON surface before Imperial
 * ICT approves real SSO.
 *
 * It simulates authenticated Imperial email claims with a header-selected
 * persona. It refuses to start with NODE_ENV=production.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MOCK_PERSONAS } from '@protocols/auth-mock';
import {
  adminsRepo,
  agreementsRepo,
  auditRepo,
  denylistRepo,
  protocolTypesRepo,
  reportsRepo,
  closePool,
} from '@protocols/db';
import {
  AGREEMENT_VERSION,
  DomainError,
  EXPORT_SCHEMA_VERSION,
  canViewReport,
  normalizeEmail,
  protocolReportInputSchema,
  parseReportFilters,
  toExportRecord,
  type Principal,
} from '@protocols/domain';
import { loadDotEnv } from './env.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.resolve(here, '..', '..', '..'));

if (process.env.NODE_ENV === 'production') {
  console.error('The mock API must never run in production. It fabricates authenticated identities.');
  process.exit(1);
}

const PORT = Number(process.env.MOCK_API_PORT ?? 4000);

/**
 * "Authentication": the caller names a persona in a header. This is exactly
 * the shape of the trust boundary the real adapters implement, so a client
 * written against this API needs no changes when real SSO lands - only the
 * header goes away.
 */
const PERSONA_HEADER = 'x-mock-persona';
const EMAIL_HEADER = 'x-mock-email';

/** Distinguishes "no identity supplied" (401) from "blocked" (403). */
type PrincipalResult =
  | { kind: 'anonymous' }
  | { kind: 'denied'; email: string }
  | { kind: 'ok'; principal: Principal };

async function resolvePrincipal(req: IncomingMessage): Promise<PrincipalResult> {
  const personaKey = header(req, PERSONA_HEADER);
  const rawEmail = header(req, EMAIL_HEADER);

  const persona = DEFAULT_MOCK_PERSONAS.find((p) => p.key === personaKey);
  const email = persona ? persona.email : rawEmail ? normalizeEmail(rawEmail) : null;
  if (!email || !email.includes('@')) return { kind: 'anonymous' };

  const [admin, denied] = await Promise.all([
    adminsRepo.isActiveAdmin(email),
    denylistRepo.isDenied(email),
  ]);

  // The denylist applies here exactly as it does in the web app, so a client
  // built against this API cannot be used to reach data the UI would refuse.
  if (denied) return { kind: 'denied', email };

  return { kind: 'ok', principal: { email, role: admin ? 'admin' : 'researcher', isMock: true } };
}

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // Development convenience: a local client on another port can call this.
    'access-control-allow-origin': '*',
    'access-control-allow-headers': `content-type, ${PERSONA_HEADER}, ${EMAIL_HEADER}`,
  });
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 5_000_000) throw new DomainError('validation_failed', 'Request body too large.');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const route = `${req.method} ${url.pathname}`;

  try {
    if (req.method === 'OPTIONS') {
      json(res, 204, null);
      return;
    }

    if (route === 'GET /health') {
      json(res, 200, {
        status: 'ok',
        mode: 'mock',
        agreementVersion: AGREEMENT_VERSION,
        exportSchemaVersion: EXPORT_SCHEMA_VERSION,
      });
      return;
    }

    if (route === 'GET /personas') {
      json(res, 200, {
        personas: DEFAULT_MOCK_PERSONAS,
        usage: `Send ${PERSONA_HEADER}: <key>, or ${EMAIL_HEADER}: <address>, on every request.`,
      });
      return;
    }

    const resolved = await resolvePrincipal(req);
    if (resolved.kind === 'anonymous') {
      json(res, 401, {
        error: 'not_authenticated',
        message: `Set ${PERSONA_HEADER} (researcher, researcher2, admin) or ${EMAIL_HEADER} on the request.`,
      });
      return;
    }
    if (resolved.kind === 'denied') {
      json(res, 403, {
        error: 'access_denied',
        message: 'Access to this app has been withdrawn for this account.',
      });
      return;
    }
    const principal = resolved.principal;

    if (!(await agreementsRepo.hasAcceptedCurrentAgreement(principal.email))) {
      if (route === 'POST /agreement/accept') {
        const acceptance = await agreementsRepo.recordAcceptance(principal.email, 'mock-api');
        await auditRepo.recordAuditEvent({
          actorEmail: principal.email,
          action: 'agreement.accept',
          targetType: 'user_agreement',
          targetId: acceptance.agreementVersion,
        });
        json(res, 200, acceptance);
        return;
      }
      json(res, 403, {
        error: 'agreement_required',
        agreementVersion: AGREEMENT_VERSION,
        message: 'POST /agreement/accept before using the API, mirroring the first-access gate in the web app.',
      });
      return;
    }

    if (route === 'GET /me') {
      json(res, 200, principal);
      return;
    }

    if (route === 'GET /protocol-types') {
      json(res, 200, {
        protocolTypes: await protocolTypesRepo.listProtocolTypes({
          includeInactive: url.searchParams.get('includeInactive') === 'true',
        }),
      });
      return;
    }

    if (route === 'GET /reports') {
      const filter = parseReportFilters(url.searchParams);
      // Same rule as the web app: only an admin may drop the owner scope.
      const scope = principal.role === 'admin' && url.searchParams.get('all') === 'true'
        ? undefined
        : principal.email;
      json(res, 200, await reportsRepo.listReports(filter, scope));
      return;
    }

    const reportMatch = /^\/reports\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (req.method === 'GET' && reportMatch) {
      const report = await reportsRepo.getReport(reportMatch[1]!);
      if (!report || !canViewReport(principal, report)) {
        json(res, 404, { error: 'not_found' });
        return;
      }
      json(res, 200, report);
      return;
    }

    if (route === 'POST /reports') {
      const input = protocolReportInputSchema.parse(await readJsonBody(req));
      const type = await protocolTypesRepo.getProtocolType(input.protocolTypeId);
      if (!type || !type.active) {
        json(res, 400, { error: 'inactive_protocol_type', message: 'Choose an active protocol type.' });
        return;
      }
      const report = await reportsRepo.createReport({
        ...input,
        researcherEmail: principal.email,
        protocolTypeLabelSnapshot: type.label,
      });
      await auditRepo.recordAuditEvent({
        actorEmail: principal.email,
        action: 'report.create',
        targetType: 'protocol_report',
        targetId: report.id,
        metadata: { via: 'mock-api' },
      });
      json(res, 201, report);
      return;
    }

    if (route === 'GET /export') {
      if (principal.role !== 'admin') {
        json(res, 403, { error: 'forbidden', message: 'Exports are admin-only.' });
        return;
      }
      const filter = parseReportFilters(url.searchParams, {
        forceState: url.searchParams.get('includeRecycled') === 'true' ? 'all' : 'active',
      });
      // A development export returns one page rather than streaming; keep the
      // page large so a client sees the whole seeded dataset in one call.
      const { reports } = await reportsRepo.listReports({ ...filter, pageSize: 200 });
      await auditRepo.recordAuditEvent({
        actorEmail: principal.email,
        action: 'export.run',
        targetType: 'export',
        metadata: { via: 'mock-api', rows: reports.length },
      });
      json(res, 200, { schemaVersion: EXPORT_SCHEMA_VERSION, records: reports.map(toExportRecord) });
      return;
    }

    json(res, 404, { error: 'no_such_route', route });
  } catch (err) {
    if (err instanceof DomainError) {
      json(res, err.code === 'duplicate_report' ? 409 : 400, {
        error: err.code,
        message: err.message,
        details: err.details,
      });
      return;
    }
    if (err && typeof err === 'object' && 'issues' in err) {
      json(res, 422, { error: 'validation_failed', issues: (err as { issues: unknown }).issues });
      return;
    }
    console.error('[mock-api] unhandled error', err);
    json(res, 500, { error: 'internal_error' });
  }
});

server.listen(PORT, () => {
  console.log(`Mock API listening on http://localhost:${PORT}`);
  console.log(`  Personas: GET /personas   Health: GET /health`);
  console.log(`  Authenticate with the ${PERSONA_HEADER} header. DEVELOPMENT ONLY.`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void closePool().finally(() => process.exit(0));
    });
  });
}
