import { z } from "zod";

/**
 * A persona is a portable spec. Same persona, different runtimes.
 * Stored on disk as markdown with frontmatter; this is the parsed form.
 */
export const PersonaSpec = z.object({
  id: z.string(),
  name: z.string(),
  system_prompt: z.string(),
  /** "Pro" | "Con" | "Host" | "Moderator" | custom — drives behavior + display */
  role: z.string().optional(),
  /** Short description of voice / cadence / rhetorical moves (display + system-prompt hint) */
  voice_signature: z.string().optional(),
  /** Natural-language meta-rule: when this persona wants to speak (used in poll mode) */
  buzz_in_policy: z.string().optional(),
  /** Tool names this persona may call via Host API; empty means none */
  tools_allowed: z.array(z.string()).default([]),
  /** Memory scope */
  memory_policy: z
    .enum(["ephemeral", "session-scoped", "persistent"])
    .default("ephemeral"),
});
export type PersonaSpec = z.infer<typeof PersonaSpec>;
