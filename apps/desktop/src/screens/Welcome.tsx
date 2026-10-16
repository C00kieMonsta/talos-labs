import { useState } from "react";
import type { FormEvent } from "react";
import type { ExplainerProfile } from "@talos/core";
import { ProfileForm } from "../components/ProfileForm";

export const WELCOME_LEAD =
  "Talos Labs reads your Mac's security settings, compares them with the CIS benchmark, and shows you what to fix. It changes a setting only when you ask it to, and tells you first.";

export const WELCOME_FOOTNOTE =
  "Explanations are written on this Mac by Apple Intelligence when it is available. Nothing leaves your Mac.";

export const READS = [
  "Whether your disk is encrypted and the firewall is on",
  "Update, screen lock, guest and automatic login settings",
  "Which programs listen on the network, start in the background or share files",
  "The names and permissions of browser extensions",
] as const;

export const NEVER_READS = [
  "Your documents, photos, mail or messages",
  "Passwords, keys or the contents of any secret",
  "Your computer's name or your browsing history",
  "What you type into macOS's own password dialog",
] as const;

export function Welcome({
  initial,
  onStart,
  onSkip,
}: {
  initial: ExplainerProfile;
  onStart(profile: ExplainerProfile): void;
  onSkip(): void;
}) {
  const [profile, setProfile] = useState<ExplainerProfile>(initial);

  function submit(event: FormEvent) {
    event.preventDefault();
    onStart(profile);
  }

  return (
    <main className="screen welcome">
      <header className="welcome-head">
        <h1>A calm check-up for your Mac</h1>
        <p className="lead">{WELCOME_LEAD}</p>
      </header>

      <div className="two-col read-columns">
        <section aria-labelledby="reads">
          <h2 id="reads">Reads</h2>
          <ul className="plain-list">
            {READS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="never">
          <h2 id="never">Never reads</h2>
          <ul className="plain-list">
            {NEVER_READS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>

      <form className="card" onSubmit={submit} aria-labelledby="about-you">
        <h2 id="about-you">About you</h2>
        <ProfileForm value={profile} onChange={setProfile} idPrefix="welcome" />
        <p className="muted small">{WELCOME_FOOTNOTE}</p>
        <div className="actions">
          <button type="submit" className="button button-primary">
            Start check-up
          </button>
          <button type="button" className="button button-ghost" onClick={onSkip}>
            Skip
          </button>
        </div>
      </form>
    </main>
  );
}
