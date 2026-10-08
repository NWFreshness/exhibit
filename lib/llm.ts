// THE one model client. The model may write the purpose paragraph, the family
// letter, and the training script — nothing else, and only through this
// wrapper. Adopted policy text never comes from the model. One
// OpenAI-compatible call shape, so a local endpoint and a hosted endpoint are
// the same call; tests run stubbed.

export type AllowedKind = "purpose" | "family" | "training";

export type LlmContext = {
  districtName: string;
  rupName: string;
  approved: string[];
  limited: string[];
  integrityK5?: string;
  integrity68?: string;
  integrity912?: string;
  toolDetails?: string;
  dataRule?: string;
  ownerName?: string;
};

/** Test-visible log of every model call. Production code never reads this. */
export const llmCalls: Array<{ kind: AllowedKind; at: string }> = [];

function stubText(kind: AllowedKind, ctx: LlmContext): string {
  if (kind === "purpose") {
    return (
      `${ctx.districtName} provides this AI exhibit and policy to give the board a clear ` +
      `answer to which AI tools are allowed and under what conditions. This draft covers ` +
      `staff and student use of generative AI tools, applies alongside ${ctx.rupName}, and ` +
      `treats any tool not listed as Approved as not permitted for student use until it clears review.`
    );
  }
  if (kind === "family") {
    return (
      `Dear ${ctx.districtName} families: students may use these approved tools: ` +
      `${ctx.approved.length ? ctx.approved.join(", ") : "none yet"}. ` +
      `${ctx.limited.length ? `Limited-use tools: ${ctx.limited.join(", ")}. ` : ""}` +
      `Tools not on the approved list are not permitted for student work until they clear review. ` +
      `Students who opt out receive an equivalent non-AI alternative.`
    );
  }
  // Training stub: same four blocks as the template, clearly sample text.
  return (
    `[Sample script — connect a model key to generate the real thing]\n\n` +
    `Minutes 0–3 — the rule. ${ctx.districtName} allows only listed tools for student work.\n\n` +
    `Minutes 3–7 — walk the list. Approved: ${ctx.approved.join(", ") || "none"}. ` +
    `Limited: ${ctx.limited.join(", ") || "none"}.${ctx.toolDetails ? ` ${ctx.toolDetails}` : ""}\n\n` +
    `Minutes 7–11 — data. ${ctx.dataRule || "Follow the district data rule."} ` +
    `Questions go to ${ctx.ownerName || "the council chair"}.\n\n` +
    `Minutes 11–15 — sign. Everyone signs name plus date.`
  );
}

export async function writeRestricted(kind: AllowedKind, ctx: LlmContext): Promise<string> {
  if (kind !== "purpose" && kind !== "family" && kind !== "training") {
    throw new Error(`Model write refused: kind "${kind}" is not purpose, family, or training.`);
  }
  llmCalls.push({ kind, at: new Date().toISOString() });

  const baseUrl = process.env.LLM_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.LLM_API_KEY;
  if (process.env.LLM_STUB === "1" || !baseUrl) return stubText(kind, ctx);

  const system =
    kind === "purpose"
      ? "Write a short board-policy purpose paragraph. Plain civic language. No marketing, no emoji, no claims about vendors."
      : kind === "family"
        ? "Write a short one-page family letter about the district's AI tool rules. Plain language. No marketing, no emoji."
        : "Write a 15-minute principal training script (four timed blocks: 0-3 the rule, 3-7 walk the approved/limited list, 7-11 data rules, 11-15 acknowledgment). Plain warm language for school staff. Name only the tools given, never invent vendor facts or new tools. No marketing, no emoji.";
  const user = JSON.stringify(ctx);
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || "default",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`Model call failed: ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Model returned no text; refusing to proceed.");
  return text;
}
