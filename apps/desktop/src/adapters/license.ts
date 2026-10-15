import { invoke } from "@tauri-apps/api/core";
import { parseLicense, type LicensePort, type LicenseState, type SignatureVerifier } from "@talos/core";

export class LicenseAdapter implements LicensePort {
  constructor(
    private readonly verify: SignatureVerifier,
    private readonly buildDate: string,
    private readonly revoked: ReadonlySet<string>,
  ) {}

  /** Re-verifies the stored key on every call, so revocation and build date always apply. */
  async current(): Promise<LicenseState> {
    const stored = await invoke<unknown>("license_read");
    if (typeof stored !== "string" || stored.trim().length === 0) return { status: "none" };
    return parseLicense(stored.trim(), this.verify, this.buildDate, this.revoked);
  }

  async install(key: string): Promise<LicenseState> {
    const trimmed = key.trim();
    const state = parseLicense(trimmed, this.verify, this.buildDate, this.revoked);
    if (state.status === "valid") {
      await invoke("license_write", { key: trimmed });
    }
    return state;
  }

  async remove(): Promise<void> {
    await invoke("license_delete");
  }
}
