import { CORE_VERSION } from "@talos/core";
import { useApp } from "../app/context";
import { APP_VERSION } from "../app/version";

export function About() {
  const { catalog, license } = useApp();
  return (
    <main className="screen about">
      <h1>About</h1>
      <p className="lead">
        Talos Labs reads your Mac's security settings and compares them with the CIS Apple macOS Benchmark. It
        never changes anything and never sends anything from your Mac anywhere, apart from the optional AI
        explanations you set up yourself.
      </p>
      <dl className="meta">
        <div>
          <dt>App version</dt>
          <dd>{APP_VERSION}</dd>
        </div>
        <div>
          <dt>Core version</dt>
          <dd>{CORE_VERSION}</dd>
        </div>
        <div>
          <dt>Rules catalogue</dt>
          <dd>{catalog.version}</dd>
        </div>
        <div>
          <dt>Benchmark edition</dt>
          <dd>{catalog.cisEdition}</dd>
        </div>
        <div>
          <dt>Build date</dt>
          <dd>{__BUILD_DATE__}</dd>
        </div>
        <div>
          <dt>Licence</dt>
          <dd>
            {license.status === "valid" ? (
              <span>
                {license.payload.plan}, {license.payload.seats} {license.payload.seats === 1 ? "seat" : "seats"}, updates
                until {license.payload.updatesUntil}
                <br />
                <span className="mono small">
                  id {license.payload.lid} · tag {license.payload.tag}
                </span>
              </span>
            ) : license.status === "invalid" ? (
              "Invalid"
            ) : (
              "None"
            )}
          </dd>
        </div>
      </dl>
    </main>
  );
}
