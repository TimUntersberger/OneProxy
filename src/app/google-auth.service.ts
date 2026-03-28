import { Injectable, computed, signal } from '@angular/core';

import { GOOGLE_AUTH_CONFIG } from './google-auth.config';
import { GoogleIdentityService, GoogleTokenResponse } from './google-identity.service';

type GoogleConnectionState = 'idle' | 'connecting' | 'connected' | 'error';
const STORAGE_KEY = 'oneproxy.googleAuth';
const TOKEN_EXPIRY_BUFFER_MS = 30_000;

interface StoredGoogleAuthState {
  grantedScopes: string[];
  hasAuthorizedBefore: boolean;
  accessToken: string | null;
  accessTokenExpiresAt: number | null;
  profile: GoogleUserProfile | null;
}

export interface GoogleUserProfile {
  name: string;
  email: string;
  picture: string | null;
}

@Injectable({ providedIn: 'root' })
export class GoogleAuthService {
  readonly connectionState = signal<GoogleConnectionState>('idle');
  readonly accessToken = signal<string | null>(null);
  readonly grantedScopes = signal<string[]>([]);
  readonly errorMessage = signal<string | null>(null);
  readonly profile = signal<GoogleUserProfile | null>(null);
  readonly isConfigured = computed(() => GOOGLE_AUTH_CONFIG.clientId.trim().length > 0);
  readonly hasAuthorizedBefore = signal(false);

  constructor(private readonly googleIdentityService: GoogleIdentityService) {
    this.restoreState();
  }

  async connect(options?: { force?: boolean }): Promise<void> {
    if (!this.isConfigured()) {
      this.connectionState.set('error');
      this.errorMessage.set(
        'Set src/app/google-auth.config.ts with your Google OAuth web client ID before connecting.',
      );
      return;
    }

    if (!options?.force && this.connectionState() === 'connected' && this.accessToken()) {
      this.errorMessage.set(null);
      return;
    }

    this.connectionState.set('connecting');
    this.errorMessage.set(null);

    try {
      const oauth2 = await this.googleIdentityService.loadOauth2();
      const response = await new Promise<GoogleTokenResponse>((resolve, reject) => {
        const tokenClient = oauth2.initTokenClient({
          client_id: GOOGLE_AUTH_CONFIG.clientId,
          scope: GOOGLE_AUTH_CONFIG.scopes.join(' '),
          callback: resolve,
          error_callback: (error) => reject(new Error(error.type)),
        });

        tokenClient.requestAccessToken({
          prompt: this.hasAuthorizedBefore() ? '' : 'consent',
        });
      });

      if (!response.access_token) {
        throw new Error(response.error_description ?? response.error ?? 'No access token returned.');
      }

      this.accessToken.set(response.access_token);
      this.grantedScopes.set((response.scope ?? '').split(' ').filter(Boolean));
      this.profile.set(await this.fetchUserProfile(response.access_token));
      this.hasAuthorizedBefore.set(true);
      this.connectionState.set('connected');
      this.errorMessage.set(null);
      this.persistState(response.expires_in);
    } catch (error) {
      this.accessToken.set(null);
      this.profile.set(null);
      this.connectionState.set('error');
      this.errorMessage.set(error instanceof Error ? error.message : 'Google sign-in failed.');
    }
  }

  clearSession(): void {
    this.accessToken.set(null);
    this.grantedScopes.set([]);
    this.profile.set(null);
    this.connectionState.set('idle');
    this.errorMessage.set(null);
    this.clearPersistedState();
  }

  private restoreState(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    const rawState = localStorage.getItem(STORAGE_KEY);
    if (!rawState) {
      return;
    }

    try {
      const storedState = JSON.parse(rawState) as StoredGoogleAuthState;
      this.grantedScopes.set(storedState.grantedScopes ?? []);
      this.hasAuthorizedBefore.set(Boolean(storedState.hasAuthorizedBefore));
      this.profile.set(storedState.profile ?? null);

      if (this.hasUsableStoredAccessToken(storedState)) {
        this.accessToken.set(storedState.accessToken);
        this.connectionState.set('connected');
        this.errorMessage.set(null);
        return;
      }

      if (storedState.hasAuthorizedBefore) {
        this.connectionState.set('idle');
        this.errorMessage.set('Reconnect Google to refresh the access token for this session.');
      }

      this.persistState();
    } catch {
      this.clearPersistedState();
    }
  }

  private persistState(expiresInSeconds?: number): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    const state: StoredGoogleAuthState = {
      grantedScopes: this.grantedScopes(),
      hasAuthorizedBefore: this.hasAuthorizedBefore(),
      accessToken: this.accessToken(),
      accessTokenExpiresAt:
        this.accessToken() && typeof expiresInSeconds === 'number'
          ? Date.now() + expiresInSeconds * 1000
          : this.readStoredExpiry(),
      profile: this.profile(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  private clearPersistedState(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    localStorage.removeItem(STORAGE_KEY);
  }

  private hasUsableStoredAccessToken(state: StoredGoogleAuthState): state is StoredGoogleAuthState & {
    accessToken: string;
    accessTokenExpiresAt: number;
  } {
    return (
      typeof state.accessToken === 'string' &&
      state.accessToken.length > 0 &&
      typeof state.accessTokenExpiresAt === 'number' &&
      Date.now() < state.accessTokenExpiresAt - TOKEN_EXPIRY_BUFFER_MS
    );
  }

  private readStoredExpiry(): number | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }

    try {
      const rawState = localStorage.getItem(STORAGE_KEY);
      if (!rawState) {
        return null;
      }

      const storedState = JSON.parse(rawState) as Partial<StoredGoogleAuthState>;
      return typeof storedState.accessTokenExpiresAt === 'number'
        ? storedState.accessTokenExpiresAt
        : null;
    } catch {
      return null;
    }
  }

  private async fetchUserProfile(accessToken: string): Promise<GoogleUserProfile> {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Google sign-in succeeded, but user profile could not be loaded.');
    }

    const data = (await response.json()) as {
      name?: string;
      email?: string;
      picture?: string;
    };

    return {
      name: data.name?.trim() || data.email?.trim() || 'Google Account',
      email: data.email?.trim() || '',
      picture: data.picture?.trim() || null,
    };
  }
}
