import { invoke } from "@tauri-apps/api/core";
import type { SecretName, SecretStorePort } from "@talos/core";

/** Tauri commands over the OS keychain. The value never touches localStorage. */
export class KeychainSecretStore implements SecretStorePort {
  async get(name: SecretName): Promise<string | null> {
    const value = await invoke<unknown>("secret_get", { name });
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  async set(name: SecretName, value: string): Promise<void> {
    await invoke("secret_set", { name, value });
  }

  async delete(name: SecretName): Promise<void> {
    await invoke("secret_delete", { name });
  }
}
