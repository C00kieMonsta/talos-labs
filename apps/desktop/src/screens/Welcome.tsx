import { useState } from "react";
import type { FormEvent } from "react";
import type { ExplainerProfile } from "@talos/core";
import { ProfileForm } from "../components/ProfileForm";

const READS = [
  "Whether your disk is encrypted and the firewall is on",
  "Update settings and whether an update is waiting",
  "Screen lock, guest and automatic login settings",
  "Which programs listen on the network and which start in the background",
  "File sharing, remote access and backup settings",
  "The names and permissions of browser extensions",
  "Whether your SSH keys have a passphrase and sensible permissions",
  "Whether shell config files contain patterns that look like secrets",
];

const NEVER_READS = [
  "Your documents, photos, mail or messages",
  "Passwords, keys or the contents of any secret",
  "Your computer's name or your browsing history",
  "Anything it would need an administrator password for",
];

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
        <p className="eyebrow">Talos Labs</p>
        <h1>A calm check-up for your Mac</h1>
        <p className="lead">
          Talos Labs reads your Mac's security settings, compares them with the CIS benchmark, and tells you what to
          fix and how. It only reads. It never changes anything.
        </p>
      </header>

      <div className="two-col">
        <section className="card" aria-labelledby="reads">
          <h2 id="reads">What it reads</h2>
          <ul className="plain-list">
            {READS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <section className="card" aria-labelledby="never">
          <h2 id="never">What it never reads</h2>
          <ul className="plain-list">
            {NEVER_READS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>

      <form className="card" onSubmit={submit} aria-labelledby="about-you">
        <h2 id="about-you">A little about you</h2>
        <p className="muted">
          These answers help the explanations fit your situation. They stay on this Mac. You can change them later in
          Settings.
        </p>
        <ProfileForm value={profile} onChange={setProfile} idPrefix="welcome" />
        <div className="actions">
          <button type="submit" className="button button-primary">
            Start check-up
          </button>
          <button type="button" className="button button-ghost" onClick={onSkip}>
            Skip for now
          </button>
        </div>
      </form>
    </main>
  );
}
