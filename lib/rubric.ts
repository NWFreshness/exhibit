// Visible rubric. Pure function — same logic renders in the UI and gates decisions.
// Never invents vendor facts: null/undefined training state counts as unknown.

export type AiStatus = "calls_model" | "no_model" | "unknown";
export type AgreementStatus = "signed" | "expired" | "refused" | "not_requested";

export type RubricInput = {
  aiStatus: AiStatus;
  agreementStatus: AgreementStatus;
  /** null/undefined = unknown training state (vendor fact not established). */
  usedForTraining?: boolean | null;
  /** Does the signed agreement address training use? null/undefined = unknown/silent. */
  agreementAddressesTraining?: boolean | null;
};

export type RubricVerdict = "clear" | "limited" | "hold" | "out_of_scope";

export type RubricResult = {
  verdict: RubricVerdict;
  /** Human-readable flags shown in the UI next to the suggestion. */
  flags: string[];
  /** Words shown as status, never icons. */
  label: string;
};

const LABEL: Record<RubricVerdict, string> = {
  clear: "Clear",
  limited: "Limited or Banned",
  hold: "Hold",
  out_of_scope: "Out of scope",
};

export function evaluateRubric(input: RubricInput): RubricResult {
  const flags: string[] = [];
  const training = input.usedForTraining ?? null;
  const addressed = input.agreementAddressesTraining ?? null;

  if (input.aiStatus === "no_model") {
    return {
      verdict: "out_of_scope",
      flags: ["Does not call a model: out of scope, not approved-for-AI."],
      label: LABEL.out_of_scope,
    };
  }

  if (training === true) {
    flags.push("Student or staff content used for training: limited or banned, never approved.");
    return { verdict: "limited", flags, label: LABEL.limited };
  }

  if (input.agreementStatus === "expired") {
    flags.push("Expired agreement: hold until renewed.");
    return { verdict: "hold", flags, label: LABEL.hold };
  }

  if (input.agreementStatus !== "signed") {
    flags.push(
      input.agreementStatus === "refused"
        ? "Vendor refused agreement: hold."
        : "No agreement: hold."
    );
    return { verdict: "hold", flags, label: LABEL.hold };
  }

  // Signed from here on.
  if (training === null || training === undefined) {
    flags.push("Unknown training status: hold, not approved.");
    return { verdict: "hold", flags, label: LABEL.hold };
  }

  if (addressed === null || addressed === undefined || addressed === false) {
    flags.push("Agreement silent on training: hold.");
    return { verdict: "hold", flags, label: LABEL.hold };
  }

  return { verdict: "clear", flags: ["No rubric flags."], label: LABEL.clear };
}

/** Merge catalog exhibit with the district's local override (override wins per-field).
 *  Null/empty on both sides stays Unknown — never invented. */
export type ExhibitBase = {
  callsGenModel?: boolean | null;
  whoseModel?: string | null;
  studentSent?: boolean | null;
  usedForTraining?: boolean | null;
  retention?: string | null;
  optOut?: string | null;
  subprocessors?: string | null;
  willSignAddendum?: string | null;
};

export type MergedExhibit = {
  callsGenModel: boolean | null;
  whoseModel: string | null;
  studentSent: boolean | null;
  usedForTraining: boolean | null;
  retention: string | null;
  optOut: string | null;
  subprocessors: string | null;
  willSignAddendum: string | null;
  agreementAddressesTraining: boolean | null;
};

/** Override keys the district may set on its own row. `trainingAddressed` is a
 *  district finding, not a vendor fact. Anything else in the JSON is ignored. */
export const OVERRIDE_BOOL_KEYS = [
  "callsGenModel",
  "studentSent",
  "usedForTraining",
  "trainingAddressed",
] as const;
export const OVERRIDE_TEXT_KEYS = [
  "whoseModel",
  "retention",
  "optOut",
  "subprocessors",
  "willSignAddendum",
] as const;

export function mergedExhibit(
  catalog: ExhibitBase | null,
  override: Record<string, unknown> | null | undefined
): MergedExhibit {
  const o = override ?? {};
  const pickBool = (key: string, base: boolean | null | undefined): boolean | null => {
    const v = o[key];
    if (v === true || v === false) return v;
    return base ?? null;
  };
  const pickText = (key: string, base: string | null | undefined): string | null => {
    const v = o[key];
    if (typeof v === "string" && v.trim() !== "") return v.trim().slice(0, 500);
    return base ?? null;
  };
  return {
    callsGenModel: pickBool("callsGenModel", catalog?.callsGenModel),
    whoseModel: pickText("whoseModel", catalog?.whoseModel),
    studentSent: pickBool("studentSent", catalog?.studentSent),
    usedForTraining: pickBool("usedForTraining", catalog?.usedForTraining),
    retention: pickText("retention", catalog?.retention),
    optOut: pickText("optOut", catalog?.optOut),
    subprocessors: pickText("subprocessors", catalog?.subprocessors),
    willSignAddendum: pickText("willSignAddendum", catalog?.willSignAddendum),
    agreementAddressesTraining:
      o.trainingAddressed === true || o.trainingAddressed === false
        ? (o.trainingAddressed as boolean)
        : null,
  };
}

/** Which override keys the district actually set (for "district finding" markers). */
export function overrideKeys(override: Record<string, unknown> | null | undefined): Set<string> {
  const o = override ?? {};
  const set = new Set<string>();
  for (const k of [...OVERRIDE_BOOL_KEYS, ...OVERRIDE_TEXT_KEYS]) {
    const v = o[k];
    if (v === true || v === false || (typeof v === "string" && v.trim() !== "")) set.add(k);
  }
  return set;
}
