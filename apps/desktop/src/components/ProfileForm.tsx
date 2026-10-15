import type { ExplainerProfile } from "@talos/core";

type Role = ExplainerProfile["role"];
type Technical = ExplainerProfile["technical"];

const ROLES: readonly { value: Role; label: string }[] = [
  { value: "individual", label: "For myself" },
  { value: "freelancer", label: "As a freelancer" },
  { value: "small_business", label: "In a small business" },
];

const TECHNICAL: readonly { value: Technical; label: string }[] = [
  { value: "low", label: "Not very. Keep it simple." },
  { value: "medium", label: "Somewhat. I can follow steps." },
  { value: "high", label: "Very. Be precise and brief." },
];

/** Three radio questions and one toggle. Never free text. */
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
      <fieldset>
        <legend>How do you use this Mac?</legend>
        {ROLES.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={`${idPrefix}-role`}
              checked={value.role === option.value}
              onChange={() => onChange({ ...value, role: option.value })}
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>How comfortable are you with technical settings?</legend>
        {TECHNICAL.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={`${idPrefix}-technical`}
              checked={value.technical === option.value}
              onChange={() => onChange({ ...value, technical: option.value })}
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Do you keep other people's data on this Mac, such as client files?</legend>
        <label>
          <input
            type="radio"
            name={`${idPrefix}-client-data`}
            checked={value.handlesClientData}
            onChange={() => onChange({ ...value, handlesClientData: true })}
          />
          Yes
        </label>
        <label>
          <input
            type="radio"
            name={`${idPrefix}-client-data`}
            checked={!value.handlesClientData}
            onChange={() => onChange({ ...value, handlesClientData: false })}
          />
          No
        </label>
      </fieldset>

      <label className="toggle">
        <input
          type="checkbox"
          role="switch"
          aria-checked={value.laptopLeavesHome}
          checked={value.laptopLeavesHome}
          onChange={(event) => onChange({ ...value, laptopLeavesHome: event.target.checked })}
        />
        <span>This is a laptop that leaves home</span>
      </label>
    </div>
  );
}
