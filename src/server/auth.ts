import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { appUsers, userClientAccess } from '../db/schema.ts';
import { adminAuth } from '../lib/firebase-admin.ts';

export type UserRole =
  | 'platform_admin'
  | 'support_manager'
  | 'engineering_manager'
  | 'support_agent';

export interface AuthUser {
  id: number;
  uid: string | null;
  email: string;
  name: string;
  designation: string;
  role: UserRole;
  agentAlias: string | null;
  hasGlobalClientAccess: boolean;
  accessibleClientIds: string[] | null; // null means unrestricted global access
}

export interface AuthRequest extends Request {
  authUser?: AuthUser;
}

const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET must be configured with at least 32 characters.');
  }
  return secret;
}

interface TokenPayload {
  sub: number;
  email: string;
  role: UserRole;
  exp: number;
}

export function signDemoToken(user: {
  id: number;
  email: string;
  role: UserRole;
}): string {
  const payload: TokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getAuthSecret())
    .update(encodedPayload)
    .digest('base64url');
  return `riq.${encodedPayload}.${sig}`;
}

export function verifyDemoToken(token: string): TokenPayload | null {
  if (!token.startsWith('riq.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, encodedPayload, providedSig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getAuthSecret())
    .update(encodedPayload)
    .digest('base64url');
  const providedBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return null;
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as TokenPayload;
    if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export async function hydrateAuthUserById(userId: number): Promise<AuthUser | null> {
  const rows = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  const user = rows[0];
  if (!user || !user.isActive) return null;

  let accessibleClientIds: string[] | null = null;
  if (!user.hasGlobalClientAccess) {
    const accessRows = await db
      .select({ clientId: userClientAccess.clientId })
      .from(userClientAccess)
      .where(eq(userClientAccess.userId, user.id));
    accessibleClientIds = accessRows.map((r) => r.clientId);
  }

  return {
    id: user.id,
    uid: user.uid,
    email: user.email,
    name: user.name,
    designation: user.designation,
    role: user.role as UserRole,
    agentAlias: user.agentAlias,
    hasGlobalClientAccess: user.hasGlobalClientAccess,
    accessibleClientIds,
  };
}

export async function upsertFirebaseUser(
  uid: string,
  email: string,
  displayName?: string
): Promise<AuthUser> {
  const existingByEmail = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.email, email))
    .limit(1);

  if (existingByEmail[0]) {
    const updated = await db
      .update(appUsers)
      .set({
        uid,
        name: existingByEmail[0].name || displayName || email.split('@')[0],
      })
      .where(eq(appUsers.id, existingByEmail[0].id))
      .returning();
    const hydrated = await hydrateAuthUserById(updated[0].id);
    if (!hydrated) throw new Error('Account is inactive');
    return hydrated;
  }

  const inserted = await db
    .insert(appUsers)
    .values({
      uid,
      email,
      name: displayName || email.split('@')[0],
      designation: 'Support Agent (SSO)',
      role: 'support_agent',
      hasGlobalClientAccess: true,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: appUsers.uid,
      set: { email },
    })
    .returning();

  const hydrated = await hydrateAuthUserById(inserted[0].id);
  if (!hydrated) throw new Error('Failed to load authenticated user');
  return hydrated;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'Authentication token is empty.' });
    return;
  }

  try {
    if (token.startsWith('riq.')) {
      const verified = verifyDemoToken(token);
      if (!verified) {
        res.status(401).json({ error: 'Session expired or invalid token.' });
        return;
      }
      const user = await hydrateAuthUserById(verified.sub);
      if (!user) {
        res.status(401).json({ error: 'User account not found or inactive.' });
        return;
      }
      req.authUser = user;
      next();
      return;
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const email = decodedToken.email;
    if (!email) {
      res.status(401).json({ error: 'Firebase token does not contain an email address.' });
      return;
    }
    const user = await upsertFirebaseUser(
      decodedToken.uid,
      email,
      decodedToken.name
    );
    req.authUser = user;
    next();
  } catch (error) {
    console.error('Auth verification error:', error);
    res.status(401).json({ error: 'Invalid or expired authentication credentials.' });
  }
};

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowedRoles.includes(req.authUser.role)) {
      res.status(403).json({
        error: `Forbidden: Role "${req.authUser.role}" is not permitted to perform this action. Allowed roles: ${allowedRoles.join(', ')}.`,
      });
      return;
    }
    next();
  };
}

export function canAccessClient(authUser: AuthUser, clientId: string): boolean {
  if (authUser.hasGlobalClientAccess || authUser.accessibleClientIds === null) {
    return true;
  }
  return authUser.accessibleClientIds.includes(clientId);
}

export async function getUserClientScopeFilter(userIds: number[]) {
  if (userIds.length === 0) return new Map<number, string[]>();
  const rows = await db
    .select()
    .from(userClientAccess)
    .where(inArray(userClientAccess.userId, userIds));
  const map = new Map<number, string[]>();
  for (const row of rows) {
    const arr = map.get(row.userId) ?? [];
    arr.push(row.clientId);
    map.set(row.userId, arr);
  }
  return map;
}
