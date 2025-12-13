import { AsyncLocalStorage } from "node:async_hooks";

export type ServerRequestContext = {
  userId: string | null;
  isAdmin: boolean;
  sessionId: string | null;
};

const storage = new AsyncLocalStorage<ServerRequestContext | null>();

export function getServerRequestContext(): ServerRequestContext | null {
  return storage.getStore() ?? null;
}

export function setServerRequestContext(ctx: ServerRequestContext | null) {
  storage.enterWith(ctx ?? null);
}

export function runWithServerRequestContext<T>(
  ctx: ServerRequestContext | null,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return storage.run(ctx ?? null, fn);
}

export function adoptSessionRequestContext(
  session: { userId: string; isAdmin: boolean; sessionId?: string | null } | null,
) {
  if (session) {
    setServerRequestContext({
      userId: session.userId,
      isAdmin: session.isAdmin,
      sessionId: session.sessionId ?? null,
    });
  } else {
    setServerRequestContext(null);
  }
}

export function assumeAdminRequestContext() {
  setServerRequestContext({ userId: null, isAdmin: true, sessionId: null });
}
