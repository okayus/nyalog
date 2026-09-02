import { z } from "zod";
import { ok, err, type Result } from "neverthrow";
import type { AuthError } from "./auth";
import { SpaceId } from "./space";

// 招待リンクの寿命。家族が LINE で受け取って週末に開く、くらいの幅。
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InviteId = string & { readonly __brand: unique symbol };
export const InviteId = z
  .string()
  .uuid()
  .transform((v) => v as InviteId);

// randomTokenHex(32) の出力形。DB には sha256 しか置かないので、平文はこの形しか存在しない。
export const InviteTokenSchema = z.string().regex(/^[0-9a-f]{64}$/);

export function isInviteTokenShape(token: string): boolean {
  return InviteTokenSchema.safeParse(token).success;
}

// DB から読んだ 1 行のうち、使えるかどうかの判定に要る列だけ。
export type InviteRow = {
  id: string;
  spaceId: string;
  expiresAt: string;
  consumedAt: string | null;
};

export type UsableInvite = { id: InviteId; spaceId: SpaceId };

// 「このトークンはいま使えるか」。consumed を expired より先に見るのは、使い終わった
// リンクをもう一度開いた家族には「使用済み」の方が正しい説明になるから。
export function inviteUsability(
  row: InviteRow | undefined,
  now: Date,
): Result<UsableInvite, AuthError> {
  if (!row) return err({ type: "invite_invalid", message: "Unknown invite" });
  if (row.consumedAt !== null)
    return err({ type: "invite_consumed", message: "Invite already used" });
  if (new Date(row.expiresAt).getTime() <= now.getTime()) {
    return err({ type: "invite_expired", message: "Invite expired" });
  }
  return ok({ id: InviteId.parse(row.id), spaceId: SpaceId.parse(row.spaceId) });
}

export function inviteExpiresAt(now: Date): string {
  return new Date(now.getTime() + INVITE_TTL_MS).toISOString();
}

// トークンは URL のフラグメントに置く。サーバのアクセスログにも Referer にも乗らない
// (nyalog は observability.head_sampling_rate=1 なので、クエリに置くと全部残る)。
export function inviteUrl(origin: string, token: string): string {
  return `${origin}/invite#token=${token}`;
}
