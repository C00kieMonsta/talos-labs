export type SecretName = "anthropic_api_key";

/** Backed by the OS keychain. Values are never logged or persisted elsewhere. */
export interface SecretStorePort {
  get(name: SecretName): Promise<string | null>;
  set(name: SecretName, value: string): Promise<void>;
  delete(name: SecretName): Promise<void>;
}
