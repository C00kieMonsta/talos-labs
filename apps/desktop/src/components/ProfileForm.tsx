import type { ExplainerProfile } from "@talos/core";
import { PROFILE_ROLE_LABELS, PROFILE_TECHNICAL_LABELS } from "../app/labels";

type Role = ExplainerProfile["role"];
type Technical = ExplainerProfile["technical"];

const ROLES: readonly Role[] = ["individual", "freelancer", "small_business"];
const TECHNICAL: readonly Technical[] = ["low", "medium", "high"];

export const PROFILE_QUESTIONS = {
  role: "How do you use this Mac?",
  technical: "How technical are you?",
  clientData: "I keep other people's data on this Mac, such as client files",
  laptop: "This laptop leaves home",
} as const;

/** The kit's segmented control: one fieldset, one radio per option. Shared with the Watch section's "How often". */
export function Segmented<T extends string | number>({
  legend,
  name,
  options,
  labels,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: readonly T[];
  labels: Readonly<Record<T, string>>;
  value: T;
  onChange(next: T): void;
}) {
  return (
    <fieldset className="segmented">
      <legend>{legend}</legend>
      <div className="segmented-options">
        {options.map((option) => (
          <label key={option} className={option === value ? "segment segment-on" : "segment"}>
            <input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} />
            {labels[option]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange(next: boolean): void }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" aria-checked={checked} checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Two segmented controls and two switches. Never free text. */
export function ProfileForm({
  value,
  onChange,
  idPrefix = "profile",
}: {
  value: ExplainerProfile;
  onChange(profile: ExplainerProfile): void;
  idPrefix?: string;
}) {
  return (
    <div className="profile-form">
      <Segmented
        legend={PROFILE_QUESTIONS.role}
        name={`${idPrefix}-role`}
        options={ROLES}
        labels={PROFILE_ROLE_LABELS}
        value={value.role}
        onChange={(role) => onChange({ ...value, role })}
      />
      <Segmented
        legend={PROFILE_QUESTIONS.technical}
        name={`${idPrefix}-technical`}
        options={TECHNICAL}
        labels={PROFILE_TECHNICAL_LABELS}
        value={value.technical}
        onChange={(technical) => onChange({ ...value, technical })}
      />
      <Switch
        label={PROFILE_QUESTIONS.clientData}
        checked={value.handlesClientData}
        onChange={(handlesClientData) => onChange({ ...value, handlesClientData })}
      />
      <Switch
        label={PROFILE_QUESTIONS.laptop}
        checked={value.laptopLeavesHome}
        onChange={(laptopLeavesHome) => onChange({ ...value, laptopLeavesHome })}
      />
    </div>
  );
}
