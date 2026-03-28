import { Injectable, computed, signal } from '@angular/core';

import { GOOGLE_AUTH_CONFIG } from './google-auth.config';
import { GoogleIdentityService, GoogleTokenResponse } from './google-identity.service';

type GoogleConnectionState = 'idle' | 'connecting' | 'connected' | 'error';
const STORAGE_KEY = 'oneproxy.googleAuth';

interface StoredGoogleAuthState {
  grantedScopes: string[];
  hasAuthorizedBefore: boolean;
}

@Injectable({ providedIn: 'root' })
export class GoogleAuthService {
  readonly connectionState = signal<GoogleConnectionState>('idle');
  readonly accessToken = signal<string | null>(null);
  readonly grantedScopes = signal<string[]>([]);
  readonly errorMessage = signal<string | null>(null);
  readonly isConfigured = computed(() => GOOGLE_AUTH_CONFIG.clientId.trim().length > 0);
  readonly hasAuthorizedBefore = signal(false);

  constructor(private readonly googleIdentityService: GoogleIdentityService) {
    this.restoreState();
  }

  async connect(): Promise<void> {
    if (!this.isConfigured()) {
      this.connectionState.set('error');
      this.errorMessage.set(
        'Set src/app/google-auth.config.ts with your Google OAuth web client ID before connecting.',
      );
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
      this.hasAuthorizedBefore.set(true);
      this.connectionState.set('connected');
      this.errorMessage.set(null);
      this.persistState();
    } catch (error) {
      this.connectionState.set('error');
      this.errorMessage.set(error instanceof Error ? error.message : 'Google sign-in failed.');
    }
  }

  clearSession(): void {
    this.accessToken.set(null);
    this.connectionState.set('idle');
    this.errorMessage.set(null);
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

      if (storedState.hasAuthorizedBefore) {
        this.connectionState.set('idle');
        this.errorMessage.set('Reconnect Google to refresh the access token for this session.');
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  private persistState(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    const state: StoredGoogleAuthState = {
      grantedScopes: this.grantedScopes(),
      hasAuthorizedBefore: this.hasAuthorizedBefore(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}
