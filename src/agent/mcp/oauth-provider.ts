// DH-0057: dh's `OAuthClientProvider` implementation, backed by the on-disk `McpTokenStore`.
//
// The SDK (`client/auth.js`) does all the OAuth heavy lifting — discovery, DCR, PKCE,
// exchange, refresh. dh supplies only persistence and the one behavioral deviation that makes
// OAuth fit a no-approval-prompt harness: `redirectToAuthorization` DOES NOT open a browser.
// It records the URL so the McpAuth tool can return it to the agent, which relays it to the
// operator to open out-of-band.

import { randomBytes } from "node:crypto";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { McpServerAuthConfig } from "../../contracts/index.ts";
import type { McpTokenStore, StoredOAuthTokens } from "./token-store.ts";

/** Placeholder loopback redirect used only to keep the SDK on the interactive/refresh branch
 * during a plain connect; a real `begin` replaces it with the live loopback receiver's URI. */
const PLACEHOLDER_REDIRECT_URI = "http://127.0.0.1/callback";

export class DhOAuthProvider implements OAuthClientProvider {
  /** Set by the McpManager before an interactive `begin` — the loopback receiver's redirect
   * URI. Undefined for `client_credentials` (non-interactive) so the SDK takes the
   * non-interactive token path. */
  loopbackRedirectUri: string | undefined;
  /** Stashed by `redirectToAuthorization` for the tool to return; not auto-opened. */
  pendingAuthorizationUrl: URL | undefined;
  /** The CSRF `state` issued for the in-flight authorization, for `complete` to verify. */
  issuedState: string | undefined;

  constructor(
    private readonly serverName: string,
    private readonly serverUrl: string,
    private readonly authConfig: McpServerAuthConfig,
    private readonly store: McpTokenStore,
  ) {}

  private get grant(): "authorization_code" | "client_credentials" {
    return this.authConfig.grant ?? "authorization_code";
  }

  get redirectUrl(): string | undefined {
    // client_credentials is non-interactive: no redirect URL at all (the SDK treats a falsy
    // redirectUrl as the non-interactive flow).
    if (this.grant === "client_credentials") return undefined;
    // authorization_code must ALWAYS report a redirect URL: the SDK derives its
    // interactive-vs-non-interactive decision from `!redirectUrl`, and a plain connect
    // (auto-refresh) must stay on the interactive/refresh branch, not fall through to the
    // machine-to-machine token path. When no interactive flow is live we hand back a
    // placeholder loopback URL — refresh never actually uses redirect_uri; a real `begin`
    // overrides this with the live loopback receiver's URI.
    return this.loopbackRedirectUri ?? PLACEHOLDER_REDIRECT_URI;
  }

  get clientMetadata(): OAuthClientMetadata {
    const grantTypes =
      this.grant === "client_credentials"
        ? ["client_credentials"]
        : ["authorization_code", "refresh_token"];
    return {
      client_name: "dh",
      redirect_uris:
        this.grant === "client_credentials"
          ? []
          : [this.loopbackRedirectUri ?? PLACEHOLDER_REDIRECT_URI],
      grant_types: grantTypes,
      response_types: ["code"],
      token_endpoint_auth_method: this.authConfig.clientSecret ? "client_secret_post" : "none",
      ...(this.authConfig.scopes ? { scope: this.authConfig.scopes.join(" ") } : {}),
    };
  }

  state(): string {
    const s = randomBytes(24).toString("base64url");
    this.issuedState = s;
    return s;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    // Static credentials from config win over anything stored (DCR).
    if (this.authConfig.clientId) {
      return {
        client_id: this.authConfig.clientId,
        ...(this.authConfig.clientSecret ? { client_secret: this.authConfig.clientSecret } : {}),
      };
    }
    return this.store.read()?.clientInformation;
  }

  saveClientInformation(info: OAuthClientInformationFull): void {
    this.store.update((current) => {
      current.serverName = this.serverName;
      current.serverUrl = this.serverUrl;
      current.clientInformation = info;
    });
  }

  tokens(): OAuthTokens | undefined {
    return this.store.read()?.tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    const stamped: StoredOAuthTokens = { ...tokens, obtained_at: Date.now() };
    this.store.update((current) => {
      current.serverName = this.serverName;
      current.serverUrl = this.serverUrl;
      current.tokens = stamped;
      // The verifier is single-use — clear it once tokens exist.
      delete current.codeVerifier;
    });
  }

  saveCodeVerifier(verifier: string): void {
    this.store.update((current) => {
      current.serverName = this.serverName;
      current.serverUrl = this.serverUrl;
      current.codeVerifier = verifier;
    });
  }

  codeVerifier(): string {
    const v = this.store.read()?.codeVerifier;
    if (!v) {
      throw new Error(
        `no PKCE code verifier stored for MCP server "${this.serverName}" — call McpAuth begin first`,
      );
    }
    return v;
  }

  // The crux of fitting dh's no-approval-prompt model: record the URL, never open a browser.
  redirectToAuthorization(url: URL): void {
    this.pendingAuthorizationUrl = url;
  }

  /** Clears any in-flight interactive-authorization state before a fresh `begin`. */
  resetPendingAuth(): void {
    this.pendingAuthorizationUrl = undefined;
    this.issuedState = undefined;
  }

  // client_credentials: emit the machine-to-machine grant params so the SDK's fetchToken
  // takes the non-interactive path (it defaults to authorization_code otherwise).
  prepareTokenRequest(scope?: string): URLSearchParams | undefined {
    if (this.grant !== "client_credentials") return undefined;
    const params = new URLSearchParams({ grant_type: "client_credentials" });
    if (scope) params.set("scope", scope);
    return params;
  }
}
