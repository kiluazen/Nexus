import type { NexusEnv, NexusProps } from "../types";
import { logEntries, getHistory, updateEntry } from "../data/entries";
import { manageFriends } from "../data/friends";
import { ValidationError } from "../lib/dates";
import { UpdateInput } from "../schema/tool-inputs";

interface ApiCtx {
  props: NexusProps;
}

function userCtx(props: NexusProps) {
  return { userId: props.userId, email: props.email, displayName: props.displayName };
}

function err(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
}

async function dispatch(req: Request, env: NexusEnv, ctx: ApiCtx): Promise<Response> {
  const url = new URL(req.url);
  const user = userCtx(ctx.props);
  try {
    if (req.method === "GET" && url.pathname === "/api/v1/me") {
      return Response.json({
        user_id: user.userId,
        display_name: user.displayName,
        auth_enabled: true,
      });
    }
    if (req.method === "POST" && url.pathname === "/api/v1/log") {
      const body = await readJson<{ entries: unknown[]; date?: string }>(req);
      return Response.json(await logEntries(env, user, { entries: body.entries ?? [], date: body.date }));
    }
    if (req.method === "GET" && url.pathname === "/api/v1/history") {
      const qp = (k: string) => url.searchParams.get(k) ?? undefined;
      console.log("rest: /history user=", user.userId);
      const result = await getHistory(env, user, {
        date: qp("date"),
        from_date: qp("from_date"),
        to_date: qp("to_date"),
        type: qp("type") as "workout" | "meal" | "weight" | undefined,
        friend_id: qp("friend_id"),
      });
      console.log("rest: /history done, workouts=", (result as any).workouts?.length ?? 0);
      return Response.json(result);
    }
    if (req.method === "POST" && url.pathname === "/api/v1/update") {
      const body = UpdateInput.parse(await readJson<unknown>(req));
      return Response.json(await updateEntry(env, user, body));
    }
    if (req.method === "POST" && url.pathname === "/api/v1/friends") {
      const body = await readJson<{ action: string; code?: string; email?: string }>(req);
      return Response.json(await manageFriends(env, user, body));
    }
    return err("not_found", 404);
  } catch (e) {
    if (e instanceof ValidationError) return err(e.message, 400);
    console.error("REST handler error", e);
    return err("internal_error", 500);
  }
}

// Exported as ExportedHandlerWithFetch — apiHandlers shape that the lib will
// call with ctx.props populated from the OAuth grant. The lib widens ctx
// to a generic ExecutionContext<unknown>; we cast props to our shape.
const handler = {
  async fetch(request: Request, env: NexusEnv, ctx: ExecutionContext): Promise<Response> {
    const props = (ctx as ExecutionContext & { props?: NexusProps }).props;
    if (!props || !props.userId) return err("unauthorized", 401);
    return dispatch(request, env, { props });
  },
};

export default handler;
