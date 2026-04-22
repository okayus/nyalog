import { z } from "zod";

export type SpaceId = string & { readonly __brand: unique symbol };
export const SpaceId = z
  .string()
  .uuid()
  .transform((v) => v as SpaceId);

export const SpaceMemberRole = z.enum(["owner", "member"]);
export type SpaceMemberRole = z.infer<typeof SpaceMemberRole>;
