// The agents' settings (owner request 2026-10-19), site_settings key "agents": which Claude model
// writes for them, how much they may spend a day, and the switches. Read by the agents' runs and
// the admin page; written only by the admin's server action (saveAgentSettings).
import { z } from "zod";
import { selectSetting, type SettingsClient } from "@/lib/settings/db";

export const AGENTS_KEY = "agents";

/** The models the admin may pick, cheapest first, with what one run of the finder about costs. */
export const AGENT_MODELS = [
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "הכי זול ומהיר" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "איזון בין איכות למחיר" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "האיכותי ביותר, יקר פי 40 מ־Haiku" },
] as const;
export type AgentModel = (typeof AGENT_MODELS)[number]["id"];
const MODEL_IDS = AGENT_MODELS.map((m) => m.id) as [AgentModel, ...AgentModel[]];

export const agentSettingsSchema = z.object({
  model: z.enum(MODEL_IDS),
  /** The most the agents may spend on the LLM in one Israel day (USD); 0 stops them. */
  dailyBudgetUsd: z.number().min(0).max(20),
  /** The finder runs on its schedule (an admin's "run now" works either way). */
  finderEnabled: z.boolean(),
  /** An approved product is also posted to the Telegram channel (when it is configured). */
  telegramEnabled: z.boolean(),
});
export type AgentSettings = z.infer<typeof agentSettingsSchema>;

/** Until the owner saves: the cheapest model, $1 a day, nothing automatic. */
export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  model: "claude-haiku-5-5",
  dailyBudgetUsd: 1,
  finderEnabled: false,
  telegramEnabled: false,
};

/** The stored settings, or the defaults when none are saved or the row does not parse. */
export async function readAgentSettings(
  db: SettingsClient,
): Promise<{ settings: AgentSettings; updatedAt: string | null }> {
  const row = await selectSetting(db, AGENTS_KEY);
  const parsed = agentSettingsSchema.safeParse(row?.value);
  return parsed.success
    ? { settings: parsed.data, updatedAt: row?.updatedAt ?? null }
    : { settings: DEFAULT_AGENT_SETTINGS, updatedAt: null };
}
