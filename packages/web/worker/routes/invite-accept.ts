import { Hono } from "hono";
import { z } from "zod";
import { authErrorResponse, type AuthError } from "../domain/auth";
import { acceptInvite, validateInvite } from "../spaces/registration";
import type { Env } from "../types";

const AcceptSchema = z.object({ token: z.string().min(1).max(256) });

// /api/invites/accept — 既にアカウントを持つ人が別のスペースに参加する。
// spaceMiddleware の外 (spaceId はトークンから決まる)。
export const inviteAcceptRoutes = new Hono<Env>().post("/accept", async (c) => {
  const fail = (error: AuthError) => {
    const { body, status } = authErrorResponse(error);
    return c.json(body, status);
  };

  const parsed = AcceptSchema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return fail({ type: "invite_invalid", message: "Unknown invite" });

  const now = new Date();
  const found = await validateInvite(c.env.DB, parsed.data.token, now);
  if (found.isErr()) return fail(found.error);

  // 既に member なら招待を燃やさない (同じ端末を別の家族が使ったのかもしれない)。
  if (c.get("memberSpaceIds").includes(found.value.spaceId)) {
    return fail({ type: "already_member", message: "Already a member of this space" });
  }

  const joined = await acceptInvite(c.env.DB, found.value, c.get("userId"), now.toISOString());
  if (joined.isErr()) return fail(joined.error);
  return c.json({ spaceId: joined.value.spaceId }, 201);
});
